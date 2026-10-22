/**
 * PURE per-tab context builders for the CharacterSheet (bead 0c48): every
 * `_prepareContext` tab/section builder, as a plain function over plain
 * state — no Foundry globals, no ApplicationV2, no pack fetches.
 *
 * The layering contract (docs/ARCHITECTURE.md, the creator-context.ts
 * precedent): these builders live in `sheet/` (presentation), which may
 * import the rules layer — and the rules layer stays Foundry-free — so
 * everything here unit-tests headlessly with plain fixtures. Anything that
 * must touch a pack, a die or the DOM stays class-side in
 * character-sheet.ts; when a builder needs a translated string it takes an
 * i18n seam so no `game.i18n` reaches this file, and when it needs the
 * actor document (or a dependency fetched from a pack) the SHEET passes it
 * in as a plain input.
 *
 * Tested by character-context.test.ts (plain fixtures, no Foundry shim).
 */
import type { Character } from "../../data/actor/character";
import { equipStateOf, isWeaponType } from "../../data/accessors";
import type { AdvanceLedgerEntry } from "../../rules/advancement";
import { derivedRank, totalSpent } from "../../rules/advancement";
import type { ActorView } from "../../../ffg/domain/model/actor";
import { careers, equipStates, sorceryRanks } from "../../registry";
import { collectSorceryRank } from "../../rules/talent-effects";
import { isPsykerLike } from "../../rules/psyker";
import { effectiveSorceryRank } from "../../rules/casting";
import {
	effectiveMechanics,
	originByKey,
	ORIGIN_ROW_LABEL_KEYS,
	ORIGIN_ROW_ORDER,
	storedOriginPicks,
} from "../../rules/origins";
import { resolveOriginTraits } from "../../rules/origin-traits";
import {
	madnessSheetContext,
	type MadnessPoints,
	type OwnedAfflictionLike,
} from "../../rules/madness";
import type { ActionOwnedItem } from "../../rules/actions";
import { resolveAfflictionGrants } from "../../rules/afflictions";
import { fatigueThreshold, woundsMax } from "../../rules/derived";
import { actorEncumbrance } from "../../rules/encumbrance";
import {
	INVENTORY_EXCLUDED_TYPES,
	pcInventoryGroups,
	type PcInventoryItemLike,
} from "../pc-inventory";
import { characteristicLabelKey } from "../../rules/labels";
// The skills-view machinery: shared with the sheet (bead 6l90).
import {
	buildCharacteristicViews,
	mergeOwnedAndCatalogRows,
	type OwnedSkillLike,
} from "../skills-domain";
// Bead 6l90: the catalog skill row shape is structural here (the fetch
// stays sheet-side so no pack touch reaches this file).
import type { CatalogSkillLike } from "../skills-domain";
// Bead v2ll: the canonical armour/weapon rows.
import { armourLocations, weaponRows } from "./view-models";
// Actions tab (epic moew, bead 9r82): the chip context. NOTE: the import is
// LAZY (inside buildActionsContext) — actions-view's graph pulls the roll
// pipeline (orchestrator → test-dialog), a Foundry-touched island; deferring
// it keeps THIS file importable headlessly.

/** A translations seam so no Foundry i18n global reaches this module. */
export interface SheetI18n {
	localize: (key: string) => string;
	/** Vars optional so a call without them passes through byte-exact
	 * (game.i18n.format(key, undefined) === game.i18n.localize(key)). */
	format: (key: string, vars?: Record<string, string>) => string;
}

/** Structural row of a career pack document, shared by the career builders. */
export interface CareerDocRow {
	uuid?: string;
	system: {
		key: string;
		ranks?: Array<{ rank: number; xpLevel: number }>;
	};
}

/** The loose owned-item shape every builder reads (Foundry docs satisfy it). */
export interface SheetItemLike {
	id: string | null;
	uuid: string;
	name: string | null;
	type: string;
	system?: unknown;
}

/**
 * Stats tab: the career picker (bead 0ib), advancement-rank tooltips (bead
 * ayw) and the display-only XP pool.
 */
export function buildCareerContext(
	context: Record<string, unknown>,
	system: Character,
	careerDocs: CareerDocRow[],
	i18n: SheetI18n,
): void {
	// Career picker (bead 0ib): choices from the careers registry; the
	// read-only label resolves via the registry so homebrew careers work.
	context.careerLabel = system.careerKey
		? (careers.get(system.careerKey) ?? system.careerKey)
		: "";

	// Advancement (bead ayw): derived rank from the career's xpLevel
	// thresholds + the ledger, shown as a tooltip hint next to the
	// stored rank; the Advancement dialog is the purchase path.
	// Advancement button tooltip: derived-rank hint when available, else
	// the generic open label (header.hbs must stay parseable — no inline
	// || expressions with nested quotes, see character-sheet render error).
	context.advancementTooltip = i18n.localize("ADVANCE.OPEN");
	if (system.careerKey) {
		if (careerDocs.length > 0) {
			const careerDoc = careerDocs.find(
				(d) => d.system.key === system.careerKey,
			);
			const thresholds = (careerDoc?.system.ranks ?? []).map((r) => ({
				rank: r.rank,
				xpLevel: r.xpLevel,
			}));
			if (thresholds.length > 0) {
				const derived = derivedRank(
					thresholds,
					totalSpent((system.advances ?? []) as AdvanceLedgerEntry[]),
				);
				if (derived) {
					context.rankTooltip = i18n.format("ADVANCE.RANK_HINT", {
						rank: String(derived),
					});
					context.advancementTooltip = context.rankTooltip;
				}
			}
		}
	}

	// XP (owner cull): spent is DISPLAY-ONLY, derived from the
	// advancement ledger (totalSpent) — manual editing desynced the pool
	// from the ledger; the Advancement dialog is the purchase path. The
	// lifetime total stays editable.
	context.xpSpent = totalSpent((system.advances ?? []) as AdvanceLedgerEntry[]);
	context.xpTotal = system.xp?.total ?? 0;
}

/** Skills-tab inputs: the owned skill docs + the actor type + the fetched
 * catalog (the fetch stays sheet-side; this module stays Foundry-free). */
export interface SkillsContextDeps {
	items: SheetItemLike[];
	actorType: string;
	catalog: CatalogSkillLike[];
}

/** Skills tab: characteristic views + the owned/catalog skill ladder rows. */
export function buildSkillsContext(
	context: Record<string, unknown>,
	system: Character,
	deps: SkillsContextDeps,
	i18n: SheetI18n,
): void {
	context.characteristics = buildCharacteristicViews(
		system,
		// fvtt-types narrow format's vars to Record<string, string>; the
		// views pass numbers (bonus/mult) like the pre-6l90 inline code.
		// Byte-exact pass-through — no `?? {}` normalize: a call without vars
		// must reach the localiser as (key, undefined), not (key, {}). Only
		// the cast bridges the views' wider unknown-vals signature.
		(key, vars) => i18n.format(key, vars as Record<string, string>),
	);

	const ownedSkills = deps.items.filter((item) => item.type === "skill");
	const catalogByChar = new Map<string, CatalogSkillLike[]>();
	for (const entry of deps.catalog) {
		const list = catalogByChar.get(entry.characteristic) ?? [];
		list.push(entry);
		catalogByChar.set(entry.characteristic, list);
	}

	context.skillGroups = Object.keys(
		(system.characteristics ?? {}) as Record<string, unknown>,
	).map((key) => {
		const label = characteristicLabelKey(key);
		// 6l90: shared merge drops catalog entries owned under differing
		// casing (t093 semantics) so owned skills never render twice.
		const skills = mergeOwnedAndCatalogRows(
			ownedSkills.filter(
				(item) =>
					(item.system as unknown as { characteristic: string })
						.characteristic === key,
			) as unknown as OwnedSkillLike[],
			catalogByChar.get(key) ?? [],
		);
		return { key, label, skills };
	});

	context.isPC = deps.actorType === "explorer";
}

/** Actions tab (epic moew, bead 9r82): the catalog + prerequisite chips.
 *
 * The chip composition lives in ./actions-view — whose import graph drags
 * in the roll pipeline (orchestrator → test-dialog, foundry-touched at
 * module load) — so the import is deferred to call time: this file stays
 * importable headlessly, and the unit tests simply don't call this builder. */
export async function buildActionsContext(
	context: Record<string, unknown>,
	items: SheetItemLike[],
	localize: (key: string) => string,
): Promise<void> {
	const { actionsChipContext } = await import("./actions-view");
	context.actions = await actionsChipContext(
		items as unknown as ActionOwnedItem[],
		localize,
	);
}

/** Psychic-tab inputs: the owned items + the actor view (sheet-resolved). */
export interface PsychicContextDeps {
	items: SheetItemLike[];
	view: ActorView;
}

/** Psychic tab (bead m4me): powers, psyker status, sorcery, navigation. */
export function buildPsychicContext(
	context: Record<string, unknown>,
	system: Character,
	deps: PsychicContextDeps,
): void {
	// Psychic tab (bead m4me): owned powers + psyker status; the tab nav
	// itself is gated in _prepareTabs.
	context.isPsyker = isPsykerLike(deps.view);
	context.psyRating = system.psyRating ?? 0;
	// Sorcery (epic 0hap): the rank select + the Table 6-1 sanctioned
	// toggle. Owned Sorcery talents win; the field is the manual fallback.
	const sorceryRank = effectiveSorceryRank(
		collectSorceryRank(deps.view),
		system.sorceryRank,
	);
	context.sorceryRank = sorceryRank;
	context.hasSorcery = sorceryRank !== "";
	context.sanctioned = system.sanctioned !== false;
	context.sorceryRankChoices = { "": "", ...sorceryRanks.choices };
	const sustained = new Set(
		(system.sustainedPowers ?? []).map((p) => p.itemUuid),
	);
	context.psychicPowers = deps.items
		.filter((item) => item.type === "psychicpower")
		.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
		.map((item) => {
			const sys = (item.system ?? {}) as {
				powerClass?: string;
				subtype?: string;
				rating?: number;
				castAs?: string;
			};
			return {
				id: item.id,
				uuid: item.uuid,
				name: item.name,
				powerClass: sys.powerClass ?? "bound",
				classLabel: `PSYCHIC_POWER.${(sys.powerClass ?? "bound").toUpperCase()}`,
				subtype: sys.subtype ?? "focus",
				subtypeLabel: `PSYCHIC_POWER.${(sys.subtype ?? "focus").toUpperCase()}`,
				rating: sys.rating ?? 0,
				// Epic 0hap: sorcerous copies (Intelligence test, Int-Bonus PR)
				// carry a chip so hybrid casters can see the mode at a glance.
				sorcerous: sys.castAs === "sorcery",
				// Bead sa6: sustained-powers affordance (book p157 — the
				// sustain modifiers flow through rules/psychic.ts).
				sustained: sustained.has(item.uuid),
			};
		});
	// Navigator powers (bead sa6, Ch. VII): plain characteristic test with
	// mastery bonus — same tab, distinct section (owner fold-in decision).
	context.navigatorPowers = deps.items
		.filter((item) => item.type === "navigatorpower")
		.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
		.map((item) => {
			const sys = (item.system ?? {}) as {
				mastery?: string;
			};
			return {
				id: item.id,
				name: item.name,
				mastery: sys.mastery ?? "novice",
				masteryLabel: `NAVIGATOR_POWER.${(sys.mastery ?? "novice").toUpperCase()}`,
			};
		});
}

/** Localized equip-state label: module-registered states resolve through the
 * registry when present, core states via the lang keys (shared by the
 * inventory rows; the byType talents path keeps its own inline copy).
 *
 * Moved beside its ONLY consumer (the inventory builder) with the i18n seam —
 * leaving it in character-sheet.ts would have made it dead code. */
function equipStateLabel(key: string, i18n: SheetI18n): string {
	const registryLabel = equipStates.get(key);
	return registryLabel ? i18n.localize(registryLabel) : (key ?? "stowed");
}

/** Inventory + combat tabs: grouped gear, armour AP per location and weapon
 * rows, plus the talent rows the background tab builds on. */
export function buildInventoryContext(
	context: Record<string, unknown>,
	items: SheetItemLike[],
	i18n: SheetI18n,
): void {
	// Inventory: all non-skill owned items grouped by family. Weight display
	// only - aggregation/encumbrance is deliberately NOT calculated here yet.
	const byType = (types: string[]) =>
		items
			.filter((item) => types.includes(item.type))
			.map((item) => {
				const equipState = equipStateOf(item);
				const type = item.type;
				// Localized label computed here (not via a template concat):
				// module-registered states resolve through the registry when
				// present, core states via the lang keys.
				const stateKey = equipState ?? "stowed";
				const registryLabel = equipStates.get(stateKey);
				const label = registryLabel
					? i18n.localize(registryLabel)
					: stateKey;
				return {
					id: item.id,
					name: item.name,
					uuid: item.uuid,
					weight:
						((item.system as { weight?: number } | undefined)?.weight ?? 0),
					// Gear-base quantity (bead 1sxq) - only the ammunition
					// group renders it (xN usage count, bead 8uc7).
					quantity:
						((item.system as { quantity?: number } | undefined)?.quantity ??
							0),
					equipState: stateKey,
					equipStateLabel: label,
					equipped: equipState === "carried" || equipState === "worn",
					// Weapons get the inline attack/damage roll button.
					isWeapon: isWeaponType(type),
				};
			});
	// Inventory groups (bead packs-pu9): one row pass, then the pure grouping
	// (the npc-inventory contract — a loud CATCH-ALL, so a dropped item of any
	// type is rendered; the heirloom special-abilities (Table 1-2) landed
	// invisibly before this). Weight display only — aggregation/encumbrance
	// is deliberately NOT calculated here.
	const inventory = pcInventoryGroups(
		items
			.filter((item) => !INVENTORY_EXCLUDED_TYPES.has(item.type))
			.map(
				(item): PcInventoryItemLike => ({
					id: item.id,
					name: item.name,
					uuid: item.uuid,
					type: item.type,
					weight:
						((item.system as { weight?: number } | undefined)?.weight ?? 0),
					// Gear-base quantity (bead 1sxq) - only the ammunition
					// group renders it (xN usage count, bead 8uc7).
					quantity:
						((item.system as { quantity?: number } | undefined)?.quantity ??
							0),
					equipState: equipStateOf(item),
					// Localized label via the shared helper (registry-resolved, lang-key
// fallback — see equipStateLabel below).
					equipStateLabel: equipStateLabel(equipStateOf(item), i18n),
					equipped:
						equipStateOf(item) === "carried" || equipStateOf(item) === "worn",
					// Weapons get the inline attack/damage roll button.
					isWeapon: isWeaponType(item.type),
				}),
			),
	);

	// Ammunition group note (bead 8uc7): rows stay draggable (core {type,
	// uuid}); they show xN quantity in the weight slot and carry NO equip
	// toggle (the pc-inventory module sets equippable/isAmmunition per row).

	// Armour: highest AP per body location across WORN armour items (bead
	// yb6 equip-state model: stowed armour contributes nothing, matching
	// the adapter's wornArmour filter in the damage pipeline).
	// Shared canonical rows (bead v2ll), adapted to the PC record shape
	// keyed by loc.
	context.armourLocations = Object.fromEntries(
		armourLocations(items as unknown as Parameters<typeof armourLocations>[0]).map(
			({ loc, ap }) => [loc, { ap }],
		),
	);

	// Combat tab: weapons from inventory with visible stats (display only;
	// roll buttons land with the roll-damage adapter work).
	// Combat tab: shared weapon rows (bead v2ll), PC sorts by name.
	context.weapons = weaponRows(
		items as unknown as Parameters<typeof weaponRows>[0],
	).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

	context.inventory = inventory;

	// Consolidated Background tab (bead ay0): origins + career + talents.
	context.talentRows = byType(["talent"]);
}

/** Background-tab inputs: the fetched talent docs, the dynasty-actor source,
 * the origin-trait defs and the actor view — all sheet-side fetches. */
export interface BackgroundContextDeps {
	talentDocs: Array<{ uuid?: string; name?: string }>;
	actorContents: Array<{
		type?: string;
		uuid: string;
		name?: string;
		system?: { profitFactor?: number };
	}>;
	traitDefs: unknown[];
	view: ActorView;
}

/** Background tab: talents, origins, dynasty, origin traits, grants. */
export function buildBackgroundContext(
	context: Record<string, unknown>,
	system: Character,
	deps: BackgroundContextDeps,
): void {
	// Compendium link per talent row (bead oaaz): pack uuid by name
	// (case-insensitive), same careers-pack pattern as careerItemId above.
	const packDocs = deps.talentDocs;
	const talentRows = context.talentRows as Array<
		Record<string, unknown> & { name?: string; packUuid?: string }
	>;
	if (packDocs.length > 0 && talentRows.length > 0) {
		const byName = new Map(
			packDocs
				.filter((d) => d.name)
				.map((d) => [d.name!.toLowerCase(), d.uuid ?? ""]),
		);
		for (const row of talentRows) {
			row.packUuid = row.name ? (byName.get(row.name.toLowerCase()) ?? "") : "";
		}
	}

	// Origins: persisted picks (creator) resolved against the origin chart;
	// tooltip carries the verbatim book effect text.
	//
	// Driven by storedOriginPicks + ORIGIN_ROW_LABEL_KEYS rather than a
	// hand-written list of the five human fields (bead 58js): a xeno's
	// species-path picks live in `origins.path`, so a fixed list would omit
	// them from the sheet as silently as it omitted them from the save.
	const splitPick = (key: string, variantKey?: string) => {
		const entry = originByKey(key);
		if (!entry) return null;
		const variant = variantKey
			? entry.variants?.find((v) => v.key === variantKey)
			: undefined;
		const mods = effectiveMechanics(entry, variantKey).characteristics ?? [];
		return {
			name: variant ? `${entry.name}: ${variant.name}` : entry.name,
			tooltip: variant?.effect ?? entry.effect ?? "",
			mods: mods.map(
				(m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`,
			),
		};
	};
	const storedPicks = storedOriginPicks(system.origins as never);
	const originRows: Array<{
		labelKey: string;
		pick: { name: string; tooltip: string; mods: string[] } | null;
	}> = ORIGIN_ROW_ORDER.filter((row) => Boolean(storedPicks[row]?.key))
		.map((row) => ({
			labelKey: ORIGIN_ROW_LABEL_KEYS[row],
			pick: splitPick(
				storedPicks[row]?.key ?? "",
				storedPicks[row]?.variantKey,
			),
		}))
		.filter((row) => row.pick !== null);
	context.originRows = originRows;
	context.hasOrigins = originRows.length > 0;

	// Dynasty link (owner redesign): characters attach to the group's
	// dynasty actor; PF/SP live there. Picker lists all dynasty actors.
	context.dynastyUuid = system.dynastyUuid ?? "";
	context.dynastyOptions = deps.actorContents
		.filter((a) => a.type === "dynasty")
		.map((a) => ({
			uuid: a.uuid,
			name: a.name ?? "",
			label:
				a.system?.profitFactor !== undefined
					? `${a.name} (PF ${a.system.profitFactor})`
					: (a.name ?? ""),
			selected: system.dynastyUuid === a.uuid,
		}));

	// Origin traits (bead tgq9): modifier/grant/note resolution from the
	// cached pack defs; grants carry claim state, free-skill grants resolve
	// via the skill picker.
	const traitResolution = resolveOriginTraits(
		// The STORED shape, both halves: resolveOriginTraits reads it through
		// storedOriginPicks, so a xeno's path picks contribute their traits.
		system.origins as never,
		deps.traitDefs as never,
	);
	context.traitModifiers = traitResolution.modifiers.map((t) => ({
		name: t.def.name,
		value: t.def.value,
		testKeyLabel: t.def.testKey ? t.def.testKey.toUpperCase() : "",
		tooltip: t.def.text,
	}));
	context.traitGrants = traitResolution.grants.map((t) => ({
		key: `${t.def.originKey}.${t.def.traitKey}`,
		name: t.def.name,
		claimed: t.claimed,
		resolvable:
			t.def.grantKind === "free-skill" ||
			t.def.grantKind === "extra-common-lore",
		tooltip: t.def.text,
	}));
	context.traitNotes = traitResolution.notes.map((t) => ({
		name: t.def.name,
		tooltip: t.def.text,
	}));
	context.hasTraits =
		traitResolution.modifiers.length +
			traitResolution.grants.length +
			traitResolution.notes.length >
		0;
	// Affliction grants (epic nt8k): traits/talents named by owned
	// disorders/malignancies/mutations ("traits:Fear", "talents:Iron Jaw").
	// The chip copies the pack item on click; nothing is auto-granted.
	context.afflictionGrants = resolveAfflictionGrants(deps.view).map(
		(grant) => ({
			...grant,
			label: grant.benefit ? `${grant.name} ${grant.benefit}` : grant.name,
		}),
	);
}

/**
 * Career link: the compendium career item behind the actor's careerKey,
 * opened via openCareerSheet for the full crunch tables. Diagnostic log
 * when the lookup fails (bead qwp6) — pack missing, or key mismatch.
 */
export function buildCareerLinkContext(
	context: Record<string, unknown>,
	system: Character,
	careerDocs: CareerDocRow[],
): void {
	if (careerDocs.length > 0 && system.careerKey) {
		const careerDoc = careerDocs.find((d) => d.system.key === system.careerKey);
		if (!careerDoc) {
			console.warn(
				`rogue-trader | no career doc with system.key "${system.careerKey}" in the character-options pack`,
			);
		}
		context.careerItemId = careerDoc?.uuid ?? "";
	} else {
		if (careerDocs.length === 0) {
			console.warn("rogue-trader | careers pack not registered (game.packs)");
		}
		context.careerItemId = "";
	}
}

/** Derived-tab inputs: the owned items + the actor view (sheet-resolved). */
export interface DerivedContextDeps {
	items: SheetItemLike[];
	view: ActorView;
}

/** Combat tab read-outs: encumbrance + the derived (read-only) values. */
export function buildDerivedContext(
	context: Record<string, unknown>,
	system: Character,
	deps: DerivedContextDeps,
): void {
	// Core Rulebook p267: capacity keys on the SUM of Strength Bonus and
	// Toughness Bonus through Table 9-33 — SB+TB here; quantity stacks count
	// (bead qhkv; bead 1sxq).
	context.encumbrance = actorEncumbrance(
		deps.items as unknown as Parameters<typeof actorEncumbrance>[0],
		system.characteristicBonus("s") + system.characteristicBonus("t"),
	);
	// Derived values (read-only): definitional + rules-layer, no writeback.
	context.derived = {
		...system.movement(),
		initiative: system.initiativeBonus,
		woundsMax: woundsMax(deps.view),
		fatigueMax: fatigueThreshold(system),
	};
}

/** Madness-tab inputs: the madness-pack rows + the owned afflictions + the
 * actor document (the Conditions writeback target, sheet-resolved). */
export interface MadnessContextDeps {
	rows: unknown[];
	items: SheetItemLike[];
	actor: unknown;
}

/** Madness tracks + conditions (epic 1g2t, q1ql): pure helper. */
export function buildMadnessContext(
	context: Record<string, unknown>,
	system: Character,
	deps: MadnessContextDeps,
): void {
	// Madness tracks + conditions (epic 1g2t, q1ql): pure helper.
	Object.assign(
		context,
		madnessSheetContext(
			deps.rows as never,
			system as unknown as MadnessPoints,
			deps.items.map((item) => ({
				id: item.id ?? "",
				name: item.name ?? "",
				type: item.type,
				system: item.system as unknown as OwnedAfflictionLike["system"],
			})),
			deps.actor as unknown as never,
		),
	);
}

/** Notes-tab input: the rich-text enrichment seam (the document is
 * sheet-side because enrichText needs Foundry's enrichment machinery). */
export interface NotesContextDeps {
	enrich: (text: string) => Promise<string>;
}

/** Notes tab: rich-text description + motivation (owner request). */
export async function buildNotesContext(
	context: Record<string, unknown>,
	system: Character,
	deps: NotesContextDeps,
): Promise<void> {
	context.descriptionHTML = await deps.enrich(system.description);
	// Notes tab: motivation is rich text (owner request; appearance was
	// culled — the description field covers it).
	context.motivationHTML = await deps.enrich(system.life?.motivation ?? "");
}