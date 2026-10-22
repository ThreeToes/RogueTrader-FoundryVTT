/**
 * The character creator's Foundry-coupled sheet edge (beads w7zm and 669h):
 * the create-vs-update branching every actor creator performs, plus the
 * grant-application and summary-post tails of #applyGrantsAndSummary.
 *
 * This module is allowed to touch Foundry (docs/ARCHITECTURE.md: sheet
 * layer); the pure builders it orchestrates live in creator-context.ts and
 * rules/**, so anything testable without a world stays there. Tests fake
 * the Actor surface directly (see creator-apply.test.ts) — a fake
 * `Actor.create` / `actor.update` is the branch pin.
 */

import { type CatalogSkill, isUnresolvedChoice } from "../../rules/creation";
import { totalSpent, type AdvanceLedgerEntry } from "../../rules/advancement";
import { GRANTED_BY_CREATOR, skillGrantPayload } from "../../rules/grants";
import { gearsetFor } from "../../rules/gearsets";
import type { ResolvedOrigin } from "../../rules/origins";
import {
	buildSummaryCard,
	mergeLedgerWithBaseline,
	originSkillGrants,
	reconcileLegacyGrants,
	type ExistingItemLike,
} from "./creator-context";
import { buildSkillCatalog, type OptionDocLike } from "../catalog";
import type { CreatorState } from "./creator-state";
import { waitForDefaultGrants } from "../default-grants";
import { getCharacterOptionDocs } from "../pack-resolve";
import { clonePackDocPayload } from "../clone-doc";
import {
	findPackDoc,
	promptParameterisedSubject,
	talentGrant,
} from "./grant-helpers";

/**
 * The minimal actor surface the apply helpers use. Both a real Foundry
 * actor and the tests' fakes satisfy it.
 */
export interface ApplyableActor {
	name?: string | null;
	uuid?: string;
	update: (data: object) => Promise<unknown>;
	createEmbeddedDocuments: (type: string, data: object[]) => Promise<unknown>;
	deleteEmbeddedDocuments: (type: string, ids: string[]) => Promise<unknown>;
	items?: { size?: number } | readonly unknown[];
	sheet?: { render: (options?: object) => unknown };
	system?: unknown;
}

export interface CreateOrUpdateOptions {
	/**
	 * Ask before overwriting content on the update path. The CONFIRM DIALOG
	 * EXISTS ONLY at the character-creator call site today — the ship and
	 * planet creators apply silently (bead w7zm verifier note; the planet
	 * joins the shared helper with the ship's silent semantics), so this
	 * flag stays opt-in per caller instead of a silent blanket change.
	 */
	confirmOverwrite?: boolean;
	/** i18n key for the created actor's fallback name (create path only). */
	fallbackNameKey: string;
	/** Called after a successful apply (the application's close()). */
	close: () => void;
	/** Overwrite confirmation window/content keys (confirmOverwrite path). */
	confirmKeys?: {
		title: string;
		content: string;
	};
}

/**
 * Build a new actor from the wizard payload, or update the pre-existing
 * actor in place (right-click entry): payload.name = "" falls back to the
 * existing name (update) or the localized default (create); the apply tail
 * runs once on whichever actor resulted; then close + re-render the sheet.
 *
 * Returns false when the branch produced no actor (creation failed or the
 * overwrite was declined) — callers treat that as "do nothing".
 *
 * NOTE (ship-creator, bead w7zm): the ship's create path runs the stale-item
 * reconcile inside the apply tail, so its embedded-document deletion now
 * happens AFTER the system update rather than before it. The two touch
 * disjoint data trees (system stats vs creator-flagged component items), so
 * the reordering is not observable.
 */
export async function createOrUpdateActor(
	targetActor: ApplyableActor | null,
	payload: { name: string; type: string; system: object },
	applyFn: (actor: ApplyableActor) => Promise<void>,
	options: CreateOrUpdateOptions,
): Promise<boolean> {
	if (targetActor) {
		// Right-clicked actor: update in place. Confirm overwrite when asked
		// AND the actor already has content (blank new PCs apply silently).
		if (options.confirmOverwrite) {
			const system = (targetActor.system ?? {}) as {
				xp?: { spent?: number; total?: number };
			};
			const items = targetActor.items as
				| { size?: number }
				| readonly unknown[]
				| undefined;
			const hasContent =
				((items as { size?: number } | undefined)?.size ??
					(Array.isArray(items) ? items.length : 0)) > 0 ||
				(system.xp?.spent ?? 0) > 0 ||
				(system.xp?.total ?? 0) > 0;
			if (hasContent) {
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: {
						title: game.i18n!.localize(
							options.confirmKeys?.title ?? "CREATOR.APPLY_TITLE",
						),
					},
					content: game.i18n!.format(
						options.confirmKeys?.content ?? "CREATOR.APPLY_CONFIRM",
						{ name: targetActor.name ?? "" },
					),
				});
				if (!confirmed) return false;
			}
		}
		// Bead 9o5z: since bead r8mw the character creator's payload carries
		// the creation-baseline origin ledger entry under system.advances. A
		// wholesale system update ERASED the pre-existing actor's purchase
		// history and refunded its xp. When the payload carries a ledger (the
		// character creator always does; the ship creator's system does not),
		// merge the existing ledger with the baseline instead of overwriting
		// — prior purchases stay untouched and xp.spent is recomputed FROM
		// the merged ledger, so the create branch's fresh-ledger behaviour
		// is unchanged (blank actors merge to the baseline alone).
		let system = payload.system as {
			advances?: unknown;
			xp?: { total?: number; spent?: number };
		};
		if (Array.isArray(system?.advances)) {
			const existing = (targetActor.system ?? {}) as { advances?: unknown };
			const merged = mergeLedgerWithBaseline(
				existing.advances as AdvanceLedgerEntry[],
				system.advances as AdvanceLedgerEntry[],
			);
			system = {
				...system,
				advances: merged,
				xp: { ...(system.xp ?? {}), spent: totalSpent(merged) },
			};
		}
		await targetActor.update({
			name: payload.name || targetActor.name,
			system,
		} as never);
		await applyFn(targetActor);
		options.close();
		targetActor.sheet?.render({});
		return true;
	}

	const actor = (await foundry.documents.Actor.create({
		name: payload.name || game.i18n!.localize(options.fallbackNameKey),
		type: payload.type,
		system: payload.system,
	} as never)) as unknown as ApplyableActor;
	if (!actor) return false;
	await applyFn(actor);
	options.close();
	actor.sheet?.render({});
	return true;
}

// ---------------------------------------------------------------------------
// Bead 669h — the grant-application tail of #applyGrantsAndSummary
// ---------------------------------------------------------------------------

/**
 * An actor's live item snapshot for grant dedupe — the apply loop reads the
 * ACTOR's items (not the targetActor snapshot) so the create path (where
 * the createActor hook has already embedded the common-skill defaults) and
 * the update path are both idempotent (duplicate-skills bug).
 */
function liveItemNames(
	items: ApplyableActor["items"],
): Array<{ name?: string }> {
	return (
		(items as unknown as { contents?: Array<{ name?: string }> }).contents ??
		(items as unknown as Array<{ name?: string }>) ??
		[]
	);
}

/**
 * Grant the resolved origin's starting skills and talents as live items,
 * idempotent on trimmed lowercase name (bead: duplicate skills on new
 * explorers):
 *   1. catalog-matched skills (via the caller's shared-catalog build),
 *   2. talents — cloning the pack document (meh0), parameterised subjects
 *      prompted first (yclz; cancelled prompt = skipped),
 *   3. unmatched options — talents if they resolve, else surfaced (as
 *      before) for the caller's manual list.
 */
export async function applyOriginGrants(
	actor: ApplyableActor,
	resolved: ResolvedOrigin,
	catalog: CatalogSkill[],
): Promise<void> {
	const { grants, unmatched } = originSkillGrants(resolved, catalog);
	const provenance = { grantedBy: GRANTED_BY_CREATOR };
	// Merge on name, case-insensitive + trimmed.
	const normName = (name: string) => name.trim().toLowerCase();
	const itemGrants = [];
	const manual: string[] = [...resolved.notes];
	const seenNames = new Set(
		liveItemNames(actor.items).map((item) => normName(item.name ?? "")),
	);
	for (const grant of grants) {
		if (seenNames.has(normName(grant.name))) continue;
		seenNames.add(normName(grant.name));
		itemGrants.push(
			skillGrantPayload(grant.name, grant.system.characteristic, provenance),
		);
	}
	for (const talentName of resolved.talents) {
		if (isUnresolvedChoice(talentName)) {
			manual.push(talentName);
			continue;
		}
		// yclz: resolve parameterised talents ("Peer (choose one)") to a
		// concrete subject before granting; cancelled prompt = skipped.
		const resolvedName = await promptParameterisedSubject(talentName);
		if (!resolvedName) continue;
		if (seenNames.has(normName(resolvedName))) continue;
		seenNames.add(normName(resolvedName));
		itemGrants.push(await talentGrant(resolvedName, provenance));
	}
	for (const leftover of unmatched) {
		if (isUnresolvedChoice(leftover)) manual.push(leftover);
		else if (!seenNames.has(normName(leftover))) {
			const resolvedName = await promptParameterisedSubject(leftover);
			if (!resolvedName) continue;
			if (seenNames.has(normName(resolvedName))) continue;
			seenNames.add(normName(resolvedName));
			itemGrants.push(await talentGrant(resolvedName, provenance));
		}
	}
	if (itemGrants.length > 0) {
		await actor.createEmbeddedDocuments("Item", itemGrants as object[]);
	}
}

/**
 * Post the finish summary card (the grant step's chat tail). Foundry-
 * coupled — the pure card HTML is buildSummaryCard in creator-context.ts;
 * a LocalizeFn rides along here so its signature stays the same everywhere.
 */
export async function postSummaryCard(html: string): Promise<void> {
	await foundry.documents.ChatMessage.create({
		content: html,
	} as never);
}

// ---------------------------------------------------------------------------
// Bead hldm — the CreatorApplyService: kit, acquisition and the
// grants-and-summary tail of #onCreate, as seam-injected functions
// ---------------------------------------------------------------------------

/** The loader-provided dependencies of the kit/acquisition apply steps. */
export interface KitApplyDeps {
	/** The equipment pack documents (fetched once by the application). */
	docs: unknown[];
	/** Notification seam (Foundry notify in production). */
	notify: {
		warn: (key: string, vars?: Record<string, unknown>) => void;
	};
}

/**
 * Starting Kit grant (owner rework 2026, step 5): clone the chosen pack
 * items — options resolve by (source folder, exact name) against the
 * equipment pack; craftsmanship/quantity overrides bake into the clone;
 * weapon mods clone and attach via system.modifications (bead huaf);
 * note options grant description-only gear. Everything stamps
 * grantedBy creator provenance. A missing item is a UI warning, never a
 * silent drop.
 */
export async function applyKit(
	actor: ApplyableActor,
	state: CreatorState,
	deps: KitApplyDeps,
): Promise<void> {
	const kit = gearsetFor(state.careerKey);
	if (!kit) return;
	const notify = deps.notify;
	const docs = deps.docs;
	// Every option resolves in-memory through findPackDoc (case-insensitive,
	// mixed-type; the docs seam so no per-option refetch — epic zlwc round 4).
	for (let i = 0; i < (kit.slots ?? []).length; i++) {
		const options = kit.slots[i]?.options ?? [];
		const opt = options[state.kitPicks[i] ?? 0] ?? options[0];
		if (!opt) continue; // empty slot — the pack test forbids, belt only
		if (opt.note) {
			await actor.createEmbeddedDocuments("Item", [
				{
					name: opt.name ?? "Starting gear",
					type: "gear",
					system: {
						description: opt.description ?? "",
						grantedBy: GRANTED_BY_CREATOR,
					},
				},
			] as never);
			continue;
		}
		const doc = (await findPackDoc(null, String(opt.name ?? ""), {
			docs,
			source: opt.source,
		})) as {
			toObject: () => { system?: Record<string, unknown> };
		} | null;
		if (!doc) {
			notify.warn("CREATOR.KIT_MISSING", { name: opt.name ?? "" });
			continue;
		}
		const data = clonePackDocPayload(
			doc.toObject() as {
				_id?: string;
				system?: Record<string, unknown>;
			},
		) as {
			system?: Record<string, unknown>;
		};
		const created = (await actor.createEmbeddedDocuments("Item", [
			{
				...data,
				...(opt.rename ? { name: opt.rename } : {}),
				system: {
					...data.system,
					...(opt.craftsmanship ? { craftsmanship: opt.craftsmanship } : {}),
					...(Number(opt.quantity ?? 1) > 1 ? { quantity: opt.quantity } : {}),
					grantedBy: GRANTED_BY_CREATOR,
				},
			},
		] as never)) as unknown as Array<{ id?: string }>;
		const weaponId = created?.[0]?.id ?? "";
		const modIds: string[] = [];
		for (const modName of opt.mods ?? []) {
			const modDoc = (await findPackDoc("weapon-modification", modName, {
				docs,
			})) as {
				toObject: () => { system?: Record<string, unknown> };
			} | null;
			if (!modDoc) {
				notify.warn("CREATOR.KIT_MOD_MISSING", { name: modName });
				continue;
			}
			const modData = clonePackDocPayload(
				modDoc.toObject() as {
					_id?: string;
					system?: Record<string, unknown>;
				},
			) as {
				system?: Record<string, unknown>;
			};
			const modCreated = (await actor.createEmbeddedDocuments("Item", [
				{
					...modData,
					system: {
						...modData.system,
						grantedBy: GRANTED_BY_CREATOR,
					},
				},
			] as never)) as unknown as Array<{ id?: string }>;
			if (modCreated?.[0]?.id) modIds.push(modCreated[0].id);
		}
		if (modIds.length > 0 && weaponId && actor.items) {
			const weapon = (
				actor.items as unknown as {
					get: (id: string) => { update?: (d: object) => Promise<unknown> };
				}
			).get(weaponId);
			if (weapon?.update) {
				await weapon.update({ system: { modifications: modIds } });
			}
		}
	}
}

/**
 * Shared strip relocated to sheet/clone-doc.ts (bead 27eu — drop-clone and the
 * character-sheet trait grants clone pack docs too); re-exported here so the
 * xynx call sites (the pickers) keep their imports.
 */
export { clonePackDocPayload } from "../clone-doc";

/**
 * Stage 6 apply (bead gjvg): grant the character's single starting free
 * acquisition (printed p272, modifier +0 or better — chosen on step 3). The
 * group's PF/SP are NOT set here — they live on the dynasty document
 * (owner redesign: keep group-level decisions out of the creator).
 *
 * Stage 3.5 heirloom (bead rboc; owner rework): the rolled Table 1-2 entry
 * IS a real typed compendium item (the Heirlooms folder inherits normal
 * gear at build time, craftsmanship baked in) — clone it by name, flag-
 * markered, and stamp creator provenance. Same path as dragging from the
 * compendium, so a missed grant can be repaired by hand.
 */
export async function applyAcquisition(
	actor: ApplyableActor,
	state: CreatorState,
	deps: KitApplyDeps,
): Promise<void> {
	const notify = deps.notify;
	if (state.acquisition && state.acquisition.payload) {
		// The chip payload is a captured pack doc; strip its _id exactly like
		// the kit clones — a kit option can BE the chosen acquisition.
		const payload = clonePackDocPayload(
			state.acquisition.payload as { _id?: string } & Record<string, unknown>,
		) as Record<string, unknown>;
		await actor.createEmbeddedDocuments("Item", [
			{
				...payload,
				system: {
					...(payload as { system?: object }).system,
					grantedBy: GRANTED_BY_CREATOR,
				},
			},
		] as never);
	}
	if (!state.heirloom) return;
	const docs = deps.docs as unknown as Array<{
		name?: string;
		flags?: Record<string, Record<string, unknown>>;
		toObject: () => object;
	}>;
	const doc = docs.find(
		(d) =>
			d.name === state.heirloom?.name &&
			typeof (d.flags?.["rogue-trader"] as { item?: unknown })?.item ===
				"string",
	);
	if (!doc) {
		// Loud: the roll happened — a missed clone must not vanish silently.
		notify.warn("CREATOR.HEIRLOOM_MISSING", {
			name: state.heirloom.name,
		});
		return;
	}
	const data = clonePackDocPayload(
		doc.toObject() as {
			_id?: string;
			system?: Record<string, unknown>;
		},
	) as {
		system?: Record<string, unknown>;
	};
	await actor.createEmbeddedDocuments("Item", [
		{
			...data,
			system: {
				...data.system,
				grantedBy: GRANTED_BY_CREATOR,
			},
		},
	] as never);
}

/** The loader-provided dependencies of the grants-and-summary tail. */
export interface GrantsAndSummaryDeps {
	/** The finished character's display name (the card's heading). */
	actorName: string;
	/** The update path's pre-existing item snapshot (the reconcile input). */
	existingItems?: ExistingItemLike[];
	/** The update path's OLD stored origin picks (the reconcile input). */
	oldOrigins?: Record<string, string>;
}

/**
 * The create-or-update apply tail: reconcile the old creator grants,
 * grant starting skills/talents as live items and post the summary chat
 * card. Since bead 669h the reconcile + summary-card HTML are the pure
 * functions in creator-context.ts, the grant loop and the chat post are
 * the helpers above, so the summary format and the reconciliation are
 * unit-testable without a world (bead hldm moved the orchestration out of
 * the class for the same reason).
 */
export async function applyGrantsAndSummary(
	actor: ApplyableActor,
	state: CreatorState,
	resolved: ResolvedOrigin,
	deps: GrantsAndSummaryDeps,
): Promise<void> {
	// The createActor hook's common-skill grant is async and NOT awaited by
	// Actor.create — wait for it before merging on name, or the dedupe set
	// misses the defaults (bead t093).
	await waitForDefaultGrants(actor.uuid ?? "");
	// iufv: creator grants carry provenance; a re-run wipes ALL
	// creator-granted items and re-grants from the new picks (owner
	// decision: full wipe + re-grant). Reconciled by the PURE
	// reconcileLegacyGrants against the OLD picks.
	const { deleteIds } = reconcileLegacyGrants(
		deps.existingItems ?? [],
		deps.oldOrigins,
	);
	if (deleteIds.length > 0) {
		await actor.deleteEmbeddedDocuments("Item", deleteIds);
	}

	// Grants: catalog-matched skills, then talents (cloning the pack
	// document, meh0), then unmatched options (talents, or surfaced if
	// unresolved). Bead 656m: mapped by the SHARED builder (richer shape;
	// only name/characteristic feed matchOriginSkills). This path refetches
	// by design (the cache is a dialog-level decision, not the builder's).
	const docs = (await getCharacterOptionDocs(
		"skill",
	)) as unknown as OptionDocLike[];
	const catalog = buildSkillCatalog(docs);
	await applyOriginGrants(actor, resolved, catalog);

	// Summary card: choices + everything needing manual application. The
	// card HTML is the PURE buildSummaryCard; the chat post is the seam.
	await postSummaryCard(
		buildSummaryCard(
			{
				name: deps.actorName,
				speciesKey: state.speciesKey,
				picks: state.picks,
				careerKey: state.careerKey,
			},
			resolved,
			(key: string) => game.i18n!.localize(key),
		),
	);
}
