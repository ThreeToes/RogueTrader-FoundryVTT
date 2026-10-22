import { Character } from "../../data/actor/character";
import { prepareDroppedItems } from "./affliction-drop";
import { itemIdFromTarget } from "../dom";
import { equipStateOf, systemOf } from "../../data/accessors";
import { sheetContext } from "../context";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { imageActions } from "../image-actions";
// Memoized fetch (bead pwbr): characterOptionDocsOnce caches the
// character-options pack fetch per type per session — the pack does not
// change mid-session, so re-fetching it on every tab render was pure waste.
import { characterOptionDocsOnce, resolvePackDocument } from "../pack-resolve";
import { clonePackDocPayload } from "../clone-doc";
import {
	findPackDoc,
	packSlugToType,
	warnPackDocMissing,
} from "./grant-helpers";
import { waitForDefaultGrants } from "../default-grants";
// Bead 0c48: the per-tab context builders are the PURE functions in
// character-context.ts (the creator-context.ts pattern); the sheet keeps
// orchestration — fetches, actor view, seams — and the calls below.
import {
	buildActionsContext,
	buildBackgroundContext,
	buildCareerContext,
	buildCareerLinkContext,
	buildDerivedContext,
	buildInventoryContext,
	buildMadnessContext,
	buildNotesContext,
	buildPsychicContext,
	buildSkillsContext,
	type CareerDocRow,
	type SheetI18n,
	type SheetItemLike,
} from "./character-context";
import { criticalSheetContext } from "../../rules/criticals";
import { rollBattlesuitRepair } from "../../rules/battlesuit-repair";
import { corruptionTrack, insanityTrack } from "../../rules/madness";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import type { ActorView } from "../../../ffg/domain/model/actor";
import type { Modifier } from "../../../rules-engine/modifier";
import {
	performRoll,
	rollInitiativeAction,
	rollSnapOut,
	toggleSustainedPower,
} from "../../rules/adapter";
import { missingSkillGrants } from "../../rules/default-skills";
import { getSkillCatalog } from "./skill-catalog";
// Bead q8il: the single-source equippable-type set (sheet/pc-inventory.ts).
import { PC_EQUIPPABLE_TYPES } from "../pc-inventory";
import {
	gatePsykerTab,
	openItemAction,
	rollCharacteristicAction,
	rollDamageAction,
	rollSkillAction,
	rollWeaponAction,
	startItemRowDrag,
} from "./shared-actions";
import { equipToggleState } from "../equip";
import { findOwnedSkillForRow, LADDER_MAX, skillNameKey } from "../skills-domain";
import { openDocumentSheet, openPackItemAction } from "../pack-resolve";
import { AdvancementDialog } from "./advancement-dialog";
import { PsychicPicker } from "./psychic-picker";
import { SkillPicker } from "./skill-picker";
import { TalentPicker } from "./talent-picker";
import { combatActionChipAction } from "./actions-view";
import { enrichText } from "../rich-text";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

// (CharacteristicView, MAX_UNNATURAL_STEPS moved to sheet/skills-domain — bead 6l90)
// (The per-tab context builders moved to sheet/actor/character-context.ts —
// bead 0c48; the equipStateLabel helper moved beside its only consumer, the
// inventory builder, in the same file.)

/**
 * In-flight own-skill creations, keyed by actor + skill name (bead bwwg):
 * guards against duplicate Item creation when the button is clicked more
 * than once before the first createEmbeddedDocuments resolves (the sheet
 * does not re-render synchronously).
 */
const owningSkillKeys = new Set<string>();

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: [
			"rogue-trader",
			"sheet",
			"character",
			"rt-component",
			"rtk-window",
		],
		position: { width: 600, height: 500 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			editImage: imageActions.editImage,
			rollTest: rollCharacteristicAction,
			rollSkill: rollSkillAction,
			rollUntrained: CharacterSheet.#onRollUntrained,
			ownSkill: CharacterSheet.#onOwnSkill,
			addSkill: CharacterSheet.#onAddSkill,
			setUnnatural: CharacterSheet.#onSetUnnatural,
			setLadder: CharacterSheet.#onSetLadder,
			openItem: openItemAction,
			openPackItem: openPackItemAction,
			deleteItem: CharacterSheet.#onDeleteItem,
			rollWeapon: rollWeaponAction,
			rollDamage: rollDamageAction,
			openTalentPicker: CharacterSheet.#onOpenTalentPicker,
			toggleEquip: CharacterSheet.#onToggleEquip,
			openAdvancement: CharacterSheet.#onOpenAdvancement,
			openPsychicPicker: CharacterSheet.#onOpenPsychicPicker,
			rollPower: CharacterSheet.#onRollPower,
			toggleSustain: CharacterSheet.#onToggleSustain,
			rollNavigatorPower: CharacterSheet.#onRollNavigatorPower,
			openCareerSheet: CharacterSheet.#onOpenCareerSheet,
			claimGrant: CharacterSheet.#onClaimGrant,
			grantTrait: CharacterSheet.#onGrantTrait,
			rollTraumaTest: CharacterSheet.#onRollTraumaTest,
			rollMalignancyTest: CharacterSheet.#onRollMalignancyTest,
			snapOut: CharacterSheet.#onSnapOut,
			rollInitiative: CharacterSheet.#onRollInitiative,
			repairBattlesuit: CharacterSheet.#onRepairBattlesuit,
			combatAction: combatActionChipAction,
		},
	};

	/**
	 * Battlesuit repair (Tau Character Guide p31): rolls the Hard (-20) Tech-Use
	 * or Trade (Armourer) Test through the normal skill path and applies its
	 * Degrees of Success — one effect plus one per Degree, nothing on a failure.
	 */
	static async #onRepairBattlesuit(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		// Bead x4ly: the driver's notify/i18n/config ports are caller-bound.
		const ports = getPorts();
		await rollBattlesuitRepair(this.actor, {
			notify: ports.notify,
			i18n: ports.i18n,
			config: ports.config,
		});
	}

	/** "Snap out of it" (p296, bead q1ql): success ends the condition. */
	static async #onSnapOut(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await rollSnapOut(this.actor);
	}

	/**
	 * Roll initiative (bead dt8t → bead yxm5 funnel → bead 77r1 pipeline):
	 * 1d10 + the derived initiative bonus, funnel-visible (talent/item rows in
	 * the dialog) and assigned to every combatant of the actor via
	 * rollInitiativeAction — the `initiative` RollKind, routed through
	 * performRoll (presentation/rolls/initiative.ts).
	 */
	static async #onRollInitiative(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await rollInitiativeAction(this.actor);
	}

	/** Delete an owned inventory item. */
	static async #onDeleteItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}

	static async #onOpenTalentPicker(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new TalentPicker({ actor: this.actor }).render({ force: true });
	}

	/** Open the Spend-XP advancement dialog (bead ayw/clng). */
	static async #onOpenAdvancement(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new AdvancementDialog({ actor: this.actor }).render({ force: true });
	}

	/** Open the psychic powers compendium picker (bead m4me). */
	static async #onOpenPsychicPicker(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new PsychicPicker({ actor: this.actor }).render({ force: true });
	}

	/** Activate a psychic power (bead sa6): strength prompt -> Focus Power Test. */
	static async #onRollPower(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
		if (!itemId) return;
		await performRoll({
			kind: "psychic",
			actor: this.actor,
			itemId,
		});
	}

	/** Toggle a power's sustained state (bead sa6, book p157). */
	static async #onToggleSustain(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.closest<HTMLElement>("[data-item-uuid]");
		const uuid = row?.dataset.itemUuid;
		const name = row?.dataset.itemName;
		if (!uuid || !name) return;
		await toggleSustainedPower(this.actor, uuid, name);
	}

	/** Activate a navigator power (bead sa6, book p178): characteristic test + mastery. */
	static async #onRollNavigatorPower(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
		if (!itemId) return;
		await performRoll({
			kind: "navigator",
			actor: this.actor,
			itemId,
		});
	}

	/** Open the compendium career item sheet (Background tab, bead ay0). */
	static async #onOpenCareerSheet(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) {
			console.warn(
				"rogue-trader | career link: no data-uuid on the clicked element",
			);
			return;
		}
		try {
			// ROOT CAUSE (wwuc, diagnosed in-world 2026-09-05): fromUuid on a
			// Compendium uuid resolved to undefined even though the pack held
			// the document (pack getDocuments matched by system.key) — so the
			// old `item.sheet?.render({})` silently no-oped. Direct pack
			// resolution (sheet/pack-resolve.ts), fromUuid as fallback.
			const item = await resolvePackDocument(uuid);
			if (!item) {
				// Bead eqay: the shared warn owns BOTH the console line and the
				// user-facing toast (error severity kept).
				warnPackDocMissing(
					"career",
					uuid,
					"opening its sheet skipped",
					"compendium",
					{ key: "BACKGROUND.OPEN_CAREER_FAIL", vars: { uuid } },
				);
				return;
			}
			await openDocumentSheet(item, "career link", undefined, { uuid });
		} catch (error) {
			// Surface render failures visibly instead of dying silently —
			// CareerSheet._prepareContext errors land here.
			console.error("rogue-trader | career link failed:", error);
			getPorts().notify.error("BACKGROUND.OPEN_CAREER_FAIL", { uuid });
		}
	}

	/**
	 * Claim a pending origin grant (bead tgq9): free-skill grants open the
	 * skill picker; claiming persists in system.origins.claims. Non-resolvable
	 * grants (bionic/heirloom) only mark acknowledged so the chip stops
	 * prompting — the underlying system still has to be built.
	 */
	static async #onClaimGrant(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key) return;
		const system = this.actor.system as unknown as {
			origins?: { claims?: Record<string, boolean> };
		};
		const claims = { ...(system.origins?.claims ?? {}), [key]: true };
		await this.actor.update({
			system: { origins: { claims } },
		} as never);
		if (target.dataset.resolvable === "true") {
			await new SkillPicker({ actor: this.actor }).render({ force: true });
		}
		this.render({ force: true } as never);
	}

	/**
	 * Add a trait/talent granted by an owned affliction (epic nt8k): the
	 * "grants-item" effect names a pack-qualified item ("traits:Fear",
	 * "talents:Iron Jaw"); the click copies that pack entry onto the actor and
	 * writes the verbatim benefit/rating into the trait's `benefit` field. The
	 * pack lookup is the only reason this is async. No-op when that exact
	 * trait+benefit is already owned.
	 */
	static async #onGrantTrait(
		this: {
			actor: foundry.documents.Actor;
			render?: (options?: unknown) => void;
		},
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const pack = target.dataset.pack;
		const name = target.dataset.name;
		if (!pack || !name) return;
		const benefit = target.dataset.benefit ?? "";
		const benefitOf = (item: foundry.documents.Item) =>
			(item.system as unknown as { benefit?: string }).benefit ?? "";
		if (
			this.actor.items.some(
				(item) =>
					item.type === "trait" &&
					item.name === name &&
					benefitOf(item) === benefit,
			)
		) {
			return;
		}
		const type = packSlugToType(pack);
		if (!type) {
			// Unmapped slugs (pack-authored/GM labels like "mutations:…") used
			// to resolve against their own per-pack compendium: keep that route
			// name-only instead of warning-and-return (epic zlwc round 4).
			const doc = (await findPackDoc(null, name, {
				pack: `rogue-trader.${pack}`,
			})) as foundry.documents.Item | null;
			if (!doc) {
				// Bead eqay: warn+notify (warn severity kept) owned by the shared
				// helper — the console line now names the actually-searched pack.
				warnPackDocMissing(
					pack,
					name,
					"grant skipped",
					`rogue-trader.${pack}`,
					{
						key: "AFFLICTION.GRANT_MISSING",
						severity: "warn",
						vars: { name },
					},
				);
				return;
			}
			// Same grant write as the mapped route below: one clone (the pack doc's
			// _id stripped, bead 27eu), an optional benefit stamp, and a
			// re-rendered sheet.
			const unmapped = clonePackDocPayload(
				doc.toObject() as unknown as {
					_id?: string;
					system?: { benefit?: string };
				},
			) as unknown as { system?: { benefit?: string } };
			if (benefit && unmapped.system) unmapped.system.benefit = benefit;
			await this.actor.createEmbeddedDocuments("Item", [unmapped as never]);
			this.render?.({ force: true });
			return;
		}
		// bead 38io: the shared case-insensitive pack-by-name resolve — the
		// grants-item targets live in the character-options concept pack (bead
		// 4tj1), so the per-pack getPackDocuments idiom goes away here.
		const doc = (await findPackDoc(
			type,
			name,
		)) as foundry.documents.Item | null;
		if (!doc) {
			// Bead eqay: warn+notify (warn severity kept) owned by the shared helper.
			warnPackDocMissing(type, name, "grant skipped", undefined, {
				key: "AFFLICTION.GRANT_MISSING",
				severity: "warn",
				vars: { name },
			});
			return;
		}
		const object = clonePackDocPayload(
			doc.toObject() as unknown as {
				_id?: string;
				system?: { benefit?: string };
			},
		) as unknown as { system?: { benefit?: string } };
		if (benefit && object.system) object.system.benefit = benefit;
		await this.actor.createEmbeddedDocuments("Item", [object as never]);
		this.render?.({ force: true });
	}

	/** Cached madness-pack rows (CONFIG registry, epic 1g2t). */
	static #madnessRows(): unknown[] {
		return (
			(
				CONFIG as unknown as {
					ROGUE_TRADER?: {
						madness?: { getRows?: () => unknown[] };
					};
				}
			).ROGUE_TRADER?.madness?.getRows?.() ?? []
		);
	}

	/**
	 * Trauma Test (epic 1g2t, p296): Willpower test modified by the Insanity
	 * Track; on failure the GM rolls d100 + 10/degree of failure on Table 10-6
	 * (the chat card shows the full modifier breakdown).
	 */
	static async #onRollTraumaTest(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		const system = this.actor.system as unknown as {
			insanity?: number;
		};
		const track = insanityTrack(
			CharacterSheet.#madnessRows() as never,
			system.insanity ?? 0,
		);
		const modifiers: Modifier[] = track.modifier
			? [
					{
						id: "trauma:track",
						source: { type: "item", label: "MADNESS.TRAUMA_MODIFIER" },
						label: `${track.degree}`,
						value: track.modifier,
					},
				]
			: [];
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key: "wp",
			modifiers,
		});
	}

	/**
	 * Malignancy Test (epic 1g2t, p299): Willpower test modified by the
	 * Corruption Track; on failure roll on the Malignancies table (manual/GM).
	 *
	 * WHEN a test is DUE (Core Rulebook p299: one Malignancy Test per full 10
	 * Corruption Points; the mutation test, rolling two different
	 * characteristics, once per full 30 CP) is deliberately NOT enforced yet —
	 * the book's due-check lives only in this comment (bead aasf deleted the
	 * tested-but-dead malignancyTestsDue/mutationTestsDue helpers rather than
	 * keep an unenforced rule). Wire the due-check in here when enforced.
	 */
	static async #onRollMalignancyTest(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		const system = this.actor.system as unknown as {
			corruption?: number;
		};
		const track = corruptionTrack(
			CharacterSheet.#madnessRows() as never,
			system.corruption ?? 0,
		);
		const modifiers: Modifier[] = track.modifier
			? [
					{
						id: "malignancy:track",
						source: { type: "item", label: "MADNESS.MALIGNANCY_MODIFIER" },
						label: `${track.degree}`,
						value: track.modifier,
					},
				]
			: [];
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key: "wp",
			modifiers,
		});
	}

	/**
	 * Toggle the equip state of an inventory item. The type allowlist is the
	 * single-source PC_EQUIPPABLE_TYPES set (sheet/pc-inventory.ts, bead q8il);
	 * the state computation is the ONE shared machine (sheet/equip.ts, bead
	 * 2dvj).
	 */
	static async #onToggleEquip(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const type = item.type as string;
		if (!PC_EQUIPPABLE_TYPES.has(type)) return;
		const next = equipToggleState(type, equipStateOf(item));
		await item.update({ system: { equipState: next } });
	}

	/**
	 * Click a characteristic to roll it / click a known skill to roll it: the
	 * shared bodies (bead z4df) — the sheets only keep the action names.
	 */

	static async #onRollUntrained(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const key = target.dataset.characteristic;
		if (!name || !key) return;
		await performRoll({
			kind: "skill",
			actor: this.actor,
			characteristicKey: key,
			label: name,
		});
	}

	/** Lazy-own: create the catalog skill item at the requested ladder. */
	static async #onOwnSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const characteristic = target.dataset.characteristic;
		// Template attribute is data-value on ladder buttons (see skills.hbs).
		const ladder = Number(target.dataset.value);
		if (!name || !characteristic || Number.isNaN(ladder)) return;

		// Idempotency guard (bead bwwg): a double click (or a stale row)
		// must not create a second skill Item. Disable the button up front so
		// the browser won't fire a second action before the first resolves,
		// and look up any already-owned skill with the same name before
		// creating.
		const btn = target as HTMLButtonElement;
		if (btn.disabled) return;
		btn.disabled = true;
		// Also lock every ladder button on this row so a click on a sibling
		// ladder step cannot race the in-flight creation.
		const row = target.closest?.("li");
		const siblings = row?.querySelectorAll?.(
			'button[data-action="ownSkill"]',
		) as NodeListOf<HTMLButtonElement> | undefined;
		siblings?.forEach((btn) => {
			btn.disabled = true;
		});

		const lockKey = `${this.actor.id ?? this.actor.uuid ?? "actor"}::${skillNameKey(name)}`;
		let locked = false;
		try {
			if (owningSkillKeys.has(lockKey)) return;

			const ownedSkills = (this.actor.items ?? []).filter(
				(item: { type?: string }) => item.type === "skill",
			) as unknown as Array<{ key?: string | null; name?: string | null }>;
			const existing = findOwnedSkillForRow(ownedSkills, { name }, name);
			if (existing) return;

			owningSkillKeys.add(lockKey);
			locked = true;
			await this.actor.createEmbeddedDocuments("Item", [
				{ name, type: "skill", system: { characteristic, ladder } },
			]);
		} finally {
			if (locked) owningSkillKeys.delete(lockKey);
			btn.disabled = false;
			siblings?.forEach((btn) => {
				btn.disabled = false;
			});
		}
	}

	static async #onAddSkill(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new SkillPicker({ actor: this.actor }).render({ force: true });
	}

	static async #onSetLadder(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		const value = Number(target.dataset.value);
		if (!itemId || Number.isNaN(value)) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const current = (item as { system?: { ladder?: number } }).system?.ladder;
		// Click-to-own toggle (bead tnw): clicking the skill's active ladder
		// again removes it (no separate trash icon on the row).
		if (current === value) {
			await item.delete();
			return;
		}
		// Clamp to the shared LADDER_MAX (bead v99r): the setter previously
		// wrote the raw value, so it disagreed with the NPC sheet's cap (a
		// ladder of 99 was writable here).
		await item.update({
			system: { ladder: Math.min(LADDER_MAX, Math.max(1, value)) },
		});
	}

	/** Set the unnatural multiplier from a clicked pip; clicking the last lit pip resets to natural. */
	static async #onSetUnnatural(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		const value = Number(target.dataset.value);
		if (!key || Number.isNaN(value)) return;
		const current = systemOf(this.actor).characteristics[key]?.unnatural ?? 1;
		const next = current === value ? 1 : value;
		await this.actor.update({
			system: { characteristics: { [key]: { unnatural: next } } },
		});
	}

	static PARTS = {
		header: {
			template: `${TEMPLATE_ROOT}sheet/actor/parts/header.hbs`,
		},
		tabs: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/tabs.hbs`,
		},
		// Each tab part's root <section class="tab"> is the scroll container
		// (.rogue-trader .tab { overflow-y: auto }): the scrollable descriptor
		// makes ApplicationV2 preserve scrollTop across part replacement
		// (bead ss1d) so a delete/re-render no longer jumps the sheet to the
		// top. "" = the part's own root element (core _syncPartState).
		stats: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/stats.hbs`,
			scrollable: [""],
		},
		combat: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/combat.hbs`,
			scrollable: [""],
		},
		// Actions tab (epic moew, bead 9r82): the combat actions chip grid; the
		// root <section class="tab"> is the scroll container like every tab part.
		actions: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/actions.hbs`,
			scrollable: [""],
		},
		inventory: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/inventory.hbs`,
			scrollable: [""],
		},
		background: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/background.hbs`,
			scrollable: [""],
		},
		skills: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/skills.hbs`,
			scrollable: [""],
		},
		psychic: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/psychic.hbs`,
			scrollable: [""],
		},
		notes: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/notes.hbs`,
			scrollable: [""],
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.STATS", cssClass: "" },
				{ id: "combat", group: "primary", label: "TAB.COMBAT", cssClass: "" },
				{
					id: "actions",
					group: "primary",
					label: "TAB.ACTIONS",
					cssClass: "",
				},
				{ id: "skills", group: "primary", label: "TAB.SKILLS", cssClass: "" },
				{
					id: "background",
					group: "primary",
					label: "TAB.BACKGROUND",
					cssClass: "",
				},
				{ id: "psychic", group: "primary", label: "TAB.PSYCHIC", cssClass: "" },
				{
					id: "inventory",
					group: "primary",
					label: "TAB.INVENTORY",
					cssClass: "",
				},
				{ id: "notes", group: "primary", label: "TAB.NOTES", cssClass: "" },
			],
			initial: "data",
		},
	};

	/**
	 * The psychic tab renders only for psykers (bead m4me): shared psyker
	 * predicate (bead 73di, gatePsykerTab); this sheet gates the "psychic" id.
	 * Navigators count (Core Rulebook p182), anyone with a Psy Rating, and
	 * anyone who owns psychic/navigator powers (bead hli6 follow-up: the
	 * header psyker checkbox moved onto this tab, so owned powers must be able
	 * to reveal it for homebrew/GM-granted psykers). Mundane characters never
	 * see the tab in the nav nor the section.
	 *
	 * Bead nyns (review hardening): the view is rebuilt at the TOP of
	 * _prepareContext (after default skills, before super — the exact point
	 * the old _prepareTabs build sat at) and stashed for #contextView, so the
	 * context build reads the SAME view instead of re-copying the whole
	 * inventory mid-render. _prepareTabs no longer BUILDS the view — it
	 * CONSUMES the stash — so the gate cannot go stale even if Foundry's
	 * _prepareTabs-before-sheet-body ordering ever changes.
	 */
	#renderView: ActorView | null = null;

	#contextView(): ActorView {
		return this.#renderView ?? actorView(this.actor);
	}

	protected override _prepareTabs(
		group: string,
	): Record<string, foundry.applications.api.ApplicationV2.Tab> {
		// Consumes the view rebuilt in _prepareContext; if _prepareTabs ever
		// ran before that build, #contextView falls back to a fresh view —
		// never a stale one.
		return gatePsykerTab(
			this.#contextView(),
			super._prepareTabs(group),
			"psychic",
		);
	}

	/**
	 * Inventory rows carry their item uuid; drag transfers core {type, uuid}
	 * data so rows can be dropped onto other sheets/hotbars.
	 */
	protected _onDragStart(event: DragEvent): void {
		startItemRowDrag(event);
	}

	/**
	 * Drop an external Item onto the inventory to copy it into the actor.
	 * Drops of uuids already owned are no-ops (reordering comes later).
	 * Afflictions (disorders/malignancies/mutations) are ordinary owned Items
	 * (epic nt8k): acquisition-time dice are settled on the copy itself, not on
	 * a separate ledger.
	 */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return;
		// Bead usw3: resolvePackDocument (the ContentPort path), not
		// foundry.utils.fromUuid — the generic resolver silently no-ops for our
		// LevelDB packs in-world (bead wwuc), so dropped pack Items did nothing.
		// World-document uuids fall through to fromUuid inside the adapter.
		const source = await resolvePackDocument(data.uuid);
		if (!(source instanceof foundry.documents.Item)) return;
		if (this.actor.items.find((item) => item.uuid === source.uuid)) return;
		return this.actor.createEmbeddedDocuments(
			"Item",
			(await prepareDroppedItems(this.actor, source)) as never,
		);
	}

	/**
	 * Lazy default-skill backfill: a pc/npc opened with zero skills receives
	 * the catalog's common skills. Belt-and-braces with the createActor hook:
	 * both paths use the same pure grant and are guarded to no-op once any
	 * item exists. Covers actors created before the feature existed.
	 */
	async #ensureDefaultSkills(): Promise<void> {
		// The createActor hook's grant is async and unawaited by Foundry: wait
		// for it before the items.size guard, or a sheet opened mid-grant
		// backfills the same defaults (bead t093).
		await waitForDefaultGrants(this.actor.uuid);
		if (this.actor.items.size > 0) return;
		if (this.actor.type !== "explorer" && this.actor.type !== "npc") return;
		const documents = (await characterOptionDocsOnce(
			"skill",
		)) as foundry.documents.Item[];
		const grants = missingSkillGrants(
			documents.map(
				(doc) =>
					doc.toObject() as {
						type: string;
						name: string;
						system: {
							common?: boolean;
							characteristic: string;
							ladder: number;
						};
					},
			),
			this.actor.items.map((i) => i.name ?? ""),
		);
		if (grants.length === 0) return;
		await this.actor.createEmbeddedDocuments("Item", grants);
	}

	/**
	 * Builds the sheet context tab by tab. Orchestration only: ensure default
	 * skills -> base context -> the shared per-render career fetch -> one
	 * builder CALL per tab/section into ./character-context (bead 0c48, the
	 * creator-context.ts pattern of pure builders beside the Foundry class).
	 * The await order (skill catalog, talent pack, rich-text enrichment) is
	 * preserved, as is the assignment order into the context.
	 */
	async _prepareContext(options: { isFirstRender: boolean }) {
		await this.#ensureDefaultSkills();
		// Bead nyns review hardening: rebuild the view HERE, per render, after
		// default skills are in — both the tab gate (which may run inside
		// super) and the sheet-body builders consume this same stash.
		this.#renderView = actorView(this.actor);
		const context = sheetContext(await super._prepareContext(options as never));
		const system = this.actor.system as Character;

		// Critical Damage panel (bead ks3k): per-location totals, the effects
		// still being suffered, and whether a worn battlesuit can repair them.
		context.criticals = criticalSheetContext(this.actor);

		// Career docs fetched ONCE per render (bead yi5t) and shared by both
		// consumers below — the advancement-thresholds lookup and the career-link
		// lookup. The fetch is memoized per session (bead pwbr).
		const careerDocs = (await characterOptionDocsOnce(
			"career",
		)) as unknown as CareerDocRow[];

		// The builders are pure functions (plain inputs): the i18n seam, the
		// actor view and the owned items are resolved HERE, once, and threaded
		// through — no game/CONFIG reach the builders themselves.
		const i18n: SheetI18n = {
			format: (key, vars) =>
				game.i18n!.format(key, vars as Record<string, string>),
			localize: (key) => game.i18n!.localize(key),
		};
		const view = this.#contextView();
		const items = this.actor.items as unknown as SheetItemLike[];

		buildCareerContext(context, system, careerDocs, i18n);
		buildSkillsContext(
			context,
			system,
			{
				items,
				actorType: this.actor.type,
				catalog: await getSkillCatalog(),
			},
			i18n,
		);
		await buildActionsContext(context, items, i18n.localize);
		buildPsychicContext(context, system, { items, view });
		buildInventoryContext(context, items, i18n);
		await buildBackgroundContext(context, system, {
			talentDocs: (await characterOptionDocsOnce(
				"talent",
			)) as unknown as Array<{ uuid?: string; name?: string }>,
			actorContents: (
				(game.actors ?? []) as unknown as {
					contents: Array<{
						type?: string;
						uuid: string;
						name?: string;
						system?: { profitFactor?: number };
					}>;
				}
			).contents,
			traitDefs: (
				(
					CONFIG as unknown as {
						ROGUE_TRADER?: {
							originTraits?: { getDefs?: () => unknown[] };
						};
					}
				).ROGUE_TRADER?.originTraits?.getDefs?.() ?? []
			),
			view,
		});
		buildDerivedContext(context, system, { items, view });
		buildMadnessContext(context, system, {
			rows: CharacterSheet.#madnessRows(),
			items,
			actor: this.actor,
		});
		await buildNotesContext(context, system, {
			enrich: (text) =>
				enrichText(text, this.document, { secrets: this.document.isOwner }),
		});
		// Career link resolves against the shared careerDocs; kept after the
		// section builders to preserve the original assignment order.
		buildCareerLinkContext(context, system, careerDocs);

		return context;
	}
}

// Affliction drop machinery — the mutation pack resolution, the procedure
// settling (Ravaged Body's further mutations, Degenerate Mind, Mental
// Regressive), the roll-once characteristic dice and the mutation-roll chat
// card — lives in ./affliction-drop (bead yxpk).