/**
 * PURE context + apply-side builders for the character creator (beads a87x
 * and 669h): every `_prepareContext` concern and the summary-card/reconcile
 * parts of #applyGrantsAndSummary, each as a plain function over plain
 * state — no Foundry globals, no ApplicationV2, no pack fetches.
 *
 * The layering contract (docs/ARCHITECTURE.md): these builders live in
 * `sheet/` (presentation), which may import the rules layer — and the
 * rules layer stays Foundry-free — so everything here unit-tests
 * headlessly with plain fixtures. Anything that must touch a pack, a die
 * or the DOM stays class-side in character-creator.ts; when a builder
 * needs a translated string it takes a `localize: (key) => string` seam
 * so no `game.i18n` reaches this file.
 *
 * Tested by creator-context.test.ts (plain fixtures, no Foundry shim).
 */
import type { CharacteristicKey } from "../../data/actor/character";
import {
	availabilityModifier,
	isTrainedFor,
	type WeaponTrainingCoverage,
} from "../../rules/acquisition";
import {
	type CatalogSkill,
	careersForSpecies,
	CREATOR_LAST_STEP,
	creatorCanAdvance,
	fateFromBands,
	finalCharacteristics,
	HUMAN_SPECIES_KEY,
	isUnresolvedChoice,
	matchOriginSkills,
	type SpeciesOption,
	validatePointBuy,
	woundsFromOrigin,
	woundsFromSpecies,
} from "../../rules/creation";
import {
	type GearsetSlot,
	gearsetFor,
	kitChoicesComplete,
} from "../../rules/gearsets";
import { reconcileForCreator } from "../../rules/grants";
import {
	allowedColumns,
	type CharMod,
	entryColumns,
	fateFromTable,
	ORIGIN_ROW_LABEL_KEYS,
	type OriginPick,
	type OriginRow,
	originByKey,
	originRowsForSpecies,
	originsInRow,
	type ResolvedOrigin,
	resolveOrigins,
	storedOriginPicks,
	storedOriginsFromPicks,
} from "../../rules/origins";
// Bead a87x: the row chips' pack-doc anchors resolve through the PURE
// library layer (pack-doc-links), not the open path (pack-resolve) —
// this module must stay Foundry-free.
import { packDocAnchor } from "../pack-doc-links";

/** A translations seam so no Foundry i18n global reaches this module. */
export type LocalizeFn = (key: string) => string;

// Bead hldm: the wizard state shape, its emptyState factory and the roll
// transitions moved into the PURE collaborator creator-state.ts; re-exported
// here so the builder signatures (and the earlier beads' imports) stay valid.
export * from "./creator-state";
import { CHARACTERISTIC_ORDER, type CreatorState } from "./creator-state";

// ---------------------------------------------------------------------------
// Bead hldm — the CreatorContextBuilder's assembly step
// ---------------------------------------------------------------------------

/** The CreatorContextBuilder's fetched inputs (bead hldm): the loaders in
 * creator-packs.ts resolve them; this assembly stays PURE (localize seam,
 * plain doc lists) so the whole context shape unit-tests headlessly. */
export interface CreatorContextDeps {
	/** The wizard's current step (the Create gate's last-step bound). */
	step: number;
	/** The explorer-name field's live value (kept across re-renders). */
	name: string;
	/** The warmed talent-doc link catalog (bead hjve). */
	talentDocs: PackChipDoc[];
	/** careerKey -> suggested home-world origin keys (Table 1-1, p24). */
	suggestions: Map<string, string[]>;
	/** The STARTING careers (blank requiredCareer) of the careers pack. */
	starting: Parameters<typeof buildCareerChips>[1];
	/** The careers pack's species options, plus the human default. */
	species: SpeciesOption[];
	/** Stage-6 acquisition chips (the loader's buildAcquisitions output). */
	acquisitions: AcqOption[];
	/** The translations seam. */
	localize: LocalizeFn;
}

/**
 * Assemble the character creator's template context: everything from the
 * origin rows through the Create gate, over fetched plain inputs. The
 * application's `_prepareContext` keeps only the sheetContext call + the
 * loader awaits (bead hldm); the pure builders here own every value, so
 * Review, kit, gate and canNext all test headlessly.
 */
export function buildCreatorContext(
	context: Record<string, unknown>,
	state: CreatorState,
	deps: CreatorContextDeps,
): Record<string, unknown> {
	context.step = deps.step;
	context.name = deps.name;
	context.isRoll = state.method === "roll";
	context.isPoints = state.method === "points";
	context.characteristics = buildCharacteristicRows(state);
	const pointBuy = validatePointBuy(state.allocated);
	context.pointBuy = pointBuy;
	context.canReroll = !state.rerollUsed;

	// Origin path rows with adjacency-enforced options (bead a87x).
	context.originRows = buildOriginRows(state, deps.talentDocs);

	// Review: resolved origin + dice totals (bead a87x).
	const resolved = resolveOrigins(state.picks);
	const chars = finalCharacteristics(
		baseCharacteristics(state),
		resolved.characteristics,
	);
	context.review = buildReview(state, resolved, chars);

	// Career chips (free choice, p24) with Table 1-1 suggestions.
	const careers = buildCareerChips(state, deps.starting, deps.suggestions);
	context.careers = careers.careers;
	context.careerLabel = careers.careerLabel;

	// Species step (bead ghmn): the stage-1 bases + printed Fate/Wounds.
	const species = buildSpeciesOptions(state, deps.species, deps.localize);
	context.speciesOptions = species.speciesOptions;
	context.speciesLabel = species.speciesLabel;
	context.speciesFateFormula = species.speciesFateFormula;
	context.speciesWoundsFormula = species.speciesWoundsFormula;
	context.speciesFate = species.speciesFate;

	// Stage 6 (gjvg): the starting free acquisition chips + groups.
	context.acquisitions = deps.acquisitions;
	context.acquisitionGroups = buildAcquisitionGroups(
		deps.acquisitions as unknown as Array<Record<string, unknown>>,
		state.acqCollapsed,
	);
	context.acquisition = state.acquisition?.name ?? "";

	// Stage 3.5 (bead rboc): the Pride "Heirloom Item" roll.
	context.heirloom = buildHeirloom(state);

	// Starting Kit (owner rework 2026, step 5).
	context.kit = buildKitContext(state);

	// The Create gate (bead a87x): the pure predicate is buildCanCreate;
	// the last-step bound is deps.step (the class reads its own step).
	context.canCreate =
		deps.step === CREATOR_LAST_STEP &&
		buildCanCreate(
			state,
			context.originRows as Array<{
				row: string;
				detail: { hasCorrIns?: boolean } | null;
			}>,
			pointBuy,
			(context.kit as { present?: boolean; complete?: boolean })?.complete,
		);
	// The forward button must be enabled on every step before the last;
	// `canCreate` is step-3 only, so it cannot gate Next directly.
	context.canNext = creatorCanAdvance(deps.step, Boolean(context.canCreate));
	return context;
}

// ---------------------------------------------------------------------------
// Stage 1 — characteristics
// ---------------------------------------------------------------------------

/**
 * The final characteristics for the current wizard state: rolled totals
 * (method "roll") or base + allocated points (method "points").
 */
export function baseCharacteristics(
	state: CreatorState,
): Record<CharacteristicKey, number> {
	const base = {} as Record<CharacteristicKey, number>;
	for (const key of CHARACTERISTIC_ORDER) {
		base[key] =
			state.method === "roll"
				? (state.rolled[key] ?? state.base[key])
				: state.base[key] + (state.allocated[key] ?? 0);
	}
	return base;
}

/** The step-1 characteristic rows for the template. */
export function buildCharacteristicRows(state: {
	method: CreatorState["method"];
	rolled: Partial<Record<CharacteristicKey, number>>;
	allocated: Partial<Record<CharacteristicKey, number>>;
	base: Record<CharacteristicKey, number>;
}): Array<{
	key: CharacteristicKey;
	labelKey: string;
	rolled: number | null;
	alloc: number;
	base: number | null;
}> {
	return CHARACTERISTIC_ORDER.map((key) => {
		const labelKey = `CHARACTERISTIC.${key.toUpperCase()}`;
		const rolled = state.rolled[key];
		const alloc = state.allocated[key] ?? 0;
		return {
			key,
			labelKey,
			rolled: rolled ?? null,
			alloc,
			base:
				state.method === "roll" ? (rolled ?? null) : state.base[key] + alloc,
		};
	});
}

// ---------------------------------------------------------------------------
// Vitals + review — the wounds/fate/insanity/corruption math
// ---------------------------------------------------------------------------

/** Wounds/fate for the current character, human path vs species block. */
function vitalsForCharacter(
	state: CreatorState,
	chars: Record<CharacteristicKey, number>,
	resolved: ResolvedOrigin,
): {
	wounds: number;
	fate: number;
	woundsBreakdown: string;
	fateBreakdown: string;
} {
	const tb = Math.floor(chars.t / 10);
	if (state.speciesKey !== HUMAN_SPECIES_KEY) {
		const spec = state.speciesWounds;
		const wounds = woundsFromSpecies(spec, tb, state.rolledDice.speciesWounds);
		const rolled = state.rolledDice.speciesFateD10 ?? 1;
		const fate =
			state.speciesFate > 0
				? state.speciesFate
				: fateFromBands(state.speciesFateBands, rolled);
		const woundParts = [`${spec.toughnessMultiplier}×TB`];
		const dice = state.rolledDice.speciesWounds.join(" + ");
		if (dice) woundParts.push(dice);
		if (spec.flat) woundParts.push(String(spec.flat));
		return {
			wounds,
			fate,
			woundsBreakdown: woundParts.join(" + "),
			fateBreakdown:
				state.speciesFate > 0 ? `fixed ${fate}` : `1d10: ${rolled} → ${fate}`,
		};
	}
	const wounds = woundsFromOrigin(
		tb,
		state.rolledDice.wounds,
		resolved.woundBonus,
	);
	const fateBase = resolved.fateTable
		? fateFromTable(resolved.fateTable, state.rolledDice.fateD10 ?? 1)
		: 0;
	const woundParts = ["2×TB", ...state.rolledDice.wounds.map(String)];
	if (resolved.woundBonus) woundParts.push(String(resolved.woundBonus));
	return {
		wounds,
		fate: Math.max(0, fateBase + resolved.fateDelta),
		woundsBreakdown: woundParts.join(" + "),
		fateBreakdown:
			`d10: ${state.rolledDice.fateD10 ?? "—"}` +
			(resolved.fateDelta ? `; ${resolved.fateDelta}` : ""),
	};
}

/**
 * Starting Wounds/Fate/Insanity/Corruption for the current character plus
 * their display breakdowns (bead g45s). Only reads the pre-rolled dice in
 * state, so the Review card, the summary card and the created actor always
 * agree. The corruption-or-insanity track's rolled total (owner: book rule)
 * rides whichever track the player chose.
 */
export function resolveCreatorVitals(
	state: CreatorState,
	resolved: ResolvedOrigin,
	chars: Record<CharacteristicKey, number>,
): {
	wounds: number;
	fate: number;
	insanity: number;
	corruption: number;
	woundsBreakdown: string;
	fateBreakdown: string;
} {
	const vitals = vitalsForCharacter(state, chars, resolved);
	// Per-row attribution (bead 02zy): each rolled corruption-or-insanity die
	// rides only the track its row chose — never the shared total on both.
	const rows = resolved.corruptionOrInsanityRows ?? [];
	let corrInsInsanity = 0;
	let corrInsCorruption = 0;
	state.rolledDice.corrOrInsanity.forEach((roll, i) => {
		const row = rows[i];
		const track = row ? state.corrOrInsTrack[row] : undefined;
		if (track === "insanity") corrInsInsanity += roll;
		else if (track === "corruption") corrInsCorruption += roll;
	});
	const insanity =
		resolved.insanity +
		state.rolledDice.insanity.reduce((a, b) => a + b, 0) +
		corrInsInsanity;
	const corruption =
		resolved.corruption +
		state.rolledDice.corruption.reduce((a, b) => a + b, 0) +
		corrInsCorruption;
	return { ...vitals, insanity, corruption };
}

/** The step-5 review card numbers for the template. */
export function buildReview(
	state: CreatorState,
	resolved: ResolvedOrigin,
	chars: Record<CharacteristicKey, number>,
): {
	characteristics: Array<{
		key: CharacteristicKey;
		labelKey: string;
		value: number;
		delta: number;
	}>;
	woundsTotal: number;
	fateTotal: number;
	insanityTotal: number;
	corruptionTotal: number;
	woundsBreakdown: string;
	fateBreakdown: string;
	initiativeBonus?: number;
	profitFactor?: number;
	xpTotal: number;
	xpCost: number;
} {
	const vitals = resolveCreatorVitals(state, resolved, chars);
	return {
		characteristics: CHARACTERISTIC_ORDER.map((key) => ({
			key,
			labelKey: `CHARACTERISTIC.${key.toUpperCase()}`,
			value: chars[key],
			delta: resolved.characteristics[key] ?? 0,
		})),
		woundsTotal: vitals.wounds,
		fateTotal: vitals.fate,
		insanityTotal: vitals.insanity,
		corruptionTotal: vitals.corruption,
		woundsBreakdown: vitals.woundsBreakdown,
		fateBreakdown: vitals.fateBreakdown,
		initiativeBonus: resolved.initiativeBonus,
		profitFactor: resolved.profitFactor,
		xpTotal: 5000,
		xpCost: resolved.xpCost,
	};
}

/**
 * The new explorer's `system` payload the creator writes on finish
 * (Core Rulebook p13: 4,500 xp already spent + 500 to spend; bead b03f
 * raises the spent baseline per xpCost; bead m4me psyker status).
 */
export function buildCharacterSystemPayload(
	state: CreatorState,
	resolved: ResolvedOrigin,
	chars: Record<CharacteristicKey, number>,
): Record<string, unknown> {
	const vitals = resolveCreatorVitals(state, resolved, chars);
	return {
		characteristics: Object.fromEntries(
			CHARACTERISTIC_ORDER.map((key) => [
				key,
				{ value: chars[key], unnatural: 1 },
			]),
		),
		wounds: { value: vitals.wounds, max: vitals.wounds },
		fate: { value: vitals.fate, max: vitals.fate },
		insanity: vitals.insanity,
		corruption: vitals.corruption,
		xp: { total: 5000, spent: 4500 + resolved.xpCost },
		psyker:
			state.careerKey === "astropath-transcendent" ||
			state.careerKey === "navigator",
		psyRating: state.careerKey === "astropath-transcendent" ? 2 : 0,
		careerKey: state.careerKey,
		rank: 1,
		// Persist the Origin Path picks (bead ay0; species paths bead 58js):
		// the consolidated Background tab reads these; the summary card is not
		// the record. Built by the SHARED helper rather than by hand: a
		// hand-written list of the five human fields is exactly how a xeno's
		// picks were silently discarded.
		origins: storedOriginsFromPicks(state.picks),
	};
}

// ---------------------------------------------------------------------------
// Stage 2 — the Origin Path rows (the adjacency builder)
// ---------------------------------------------------------------------------

/**
 * The Origin rows for the chosen species (bead ghmn), DERIVED FROM THE PACK:
 * human uses the five core rows, and a xeno species uses whatever rows its
 * own entries declare (Kroot -> a single Kindred row; Into the Storm p48 is
 * explicit that they do not use the Origin Path).
 */
export function creatorOriginRows(speciesKey: string): OriginRow[] {
	return originRowsForSpecies(speciesKey);
}

/**
 * The Origin Path rows with adjacency-enforced options (the ~120-line
 * concern from _prepareContext, now covered without a Foundry render cycle).
 * `talentDocs` is the warmed talent-doc link catalog (bead hjve) — rows
 * without an anchor degrade to plain text.
 */
export function buildOriginRows(
	state: CreatorState,
	talentDocs: PackChipDoc[],
): Array<{
	row: OriginRow;
	labelKey: string;
	pickKey: string;
	options: unknown[];
	detail: Record<string, unknown> | null;
}> {
	// Adjacency rule (book): each pick allows the option below it or its
	// horizontal neighbours — `prevCol` threads the last RESOLVED pick's
	// column through the rows.
	let prevCol: number | null = null;
	const rows = creatorOriginRows(state.speciesKey);
	return rows.map((row) => {
		const pick = state.picks[row];
		const pickEntry = pick ? originByKey(pick.key) : undefined;
		const allowed = allowedColumns(row, prevCol);
		// Bead hjve: the chip's pack-doc anchor is resolved through the
		// LIBRARY (packDocAnchor: key-first, exact-name against the row's
		// own catalog — the uuid rides on the entries since bead hjve,
		// originEntryFromDoc). Null degrades the chip to plain text.
		const rowEntries = originsInRow(row);
		const options = rowEntries.map((entry) => ({
			...entry,
			// An expanded entry may substitute either of two core slots
			// (bead b03f), so check every column it may occupy.
			enabled: entryColumns(entry).some((col) => allowed.includes(col)),
			selected: pick?.key === entry.key,
			link: packDocAnchor({ key: entry.key, name: entry.name }, rowEntries, []),
		}));
		if (pickEntry) prevCol = pickEntry.col;

		const entry = pickEntry;
		const pickVariant = pick?.variantKey
			? entry?.variants?.find((v) => v.key === pick.variantKey)
			: undefined;
		let detail: Record<string, unknown> | null = null;
		if (entry) {
			const mechanicsForPick = pickVariant
				? pickVariant.mechanics
				: entry.mechanics;
			detail = {
				entry,
				effect: entry.effect ?? null,
				variants: (entry.variants ?? []).map((v) => ({
					...v,
					selected: pick?.variantKey === v.key,
				})),
				pickVariant,
				pickVariantEffect: pickVariant?.effect ?? null,
				pickOption: pick?.optionChoice ?? null,
				pickAlternate: pick?.alternate ?? null,
				// Track choice is stored under the ROW key (the write side in
				// #onChooseCorrIns uses data-row = row.row) — reading it under
				// entry.key silently never matched (bug report 2026-09-05:
				// "Choose a track" chips never highlighted).
				corrIns: state.corrOrInsTrack[row] ?? null,
				hasOptions: (mechanicsForPick?.optionChoice?.length ?? 0) > 0,
				// Selection state precomputed here (not in Handlebars paths):
				// each-scope relative paths were silently unresolvable.
				options: (mechanicsForPick?.optionChoice ?? []).map((option) => ({
					value: option,
					selected: pick?.optionChoice === option,
					// Bead hjve: the option-pick chips' values are TALENT names
					// ("Jaded", "Peer (Academics)") — resolved through the library
					// against the warmed talent catalog; a value that is not a real
					// talent (e.g. a parameterised group) degrades to plain text.
					link: packDocAnchor(
						{ key: "", name: option, type: "talent" },
						[],
						talentDocs,
					),
				})),
				hasCharChoice:
					(mechanicsForPick?.characteristicChoice?.length ?? 0) > 0,
				charChoices: (mechanicsForPick?.characteristicChoice ?? []).map(
					(group: CharMod[]) => ({
						value: JSON.stringify(group),
						label: group
							.map(
								(m) =>
									`${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`,
							)
							.join(", "),
						selected:
							JSON.stringify(pick?.charChoice ?? []) === JSON.stringify(group),
					}),
				),
				hasAlternate: (mechanicsForPick?.alternateChoice?.length ?? 0) > 0,
				alternates: (mechanicsForPick?.alternateChoice ?? []).map(
					(alt, index) => ({
						...alt,
						index,
						selected: pick?.alternate === index,
					}),
				),
				hasCorrIns:
					(mechanicsForPick?.corruptionOrInsanityDice?.length ?? 0) > 0,
				corrOrInsDice: mechanicsForPick?.corruptionOrInsanityDice ?? [],
				skills: mechanicsForPick?.skills ?? [],
				talents: mechanicsForPick?.talents ?? [],
				woundsDice: mechanicsForPick?.woundsDice ?? null,
				fateTable: mechanicsForPick?.fateTable ?? null,
				notes: mechanicsForPick?.notes ?? [],
			};
		}
		return {
			row,
			labelKey: ORIGIN_ROW_LABEL_KEYS[row],
			pickKey: pick?.key ?? "",
			options,
			detail,
		};
	});
}

/** A {key, name, uuid} catalog row (the chip link matcher's input). */
export interface PackChipDoc {
	key: string;
	name: string;
	uuid?: string;
}

// ---------------------------------------------------------------------------
// Careers, species, acquisitions, heirloom, kit, gate
// ---------------------------------------------------------------------------

/**
 * Career chips (free choice, Core Rulebook p24) with Table 1-1 suggestions,
 * built from the STARTING careers (blank requiredCareer) of the careers
 * compendium — a starting character cannot hold an alternate/elite rank.
 * `suggestedHomeWorlds` maps careerKey -> suggested home-world origin keys
 * (Table 1-1); when a home world is picked its suggestions highlight.
 */
export function buildCareerChips(
	state: CreatorState,
	startingDocs: Array<{
		name?: string;
		uuid?: string;
		system?: {
			key?: string;
			suggestedHomeWorlds?: string[];
			species?: { key?: string };
		};
	}>,
	suggestions: Map<string, string[]>,
): { careers: Array<Record<string, unknown>>; careerLabel: string } {
	const homeWorld = state.picks["home-world"]?.key;
	const suggested = homeWorld
		? new Set(
				[...suggestions.entries()]
					.filter(([, worlds]) => worlds.includes(homeWorld))
					.map(([career]) => career),
			)
		: new Set(suggestions.keys());
	// Bead hjve: the career catalog the chip doc links resolve against —
	// {key, name, uuid} rows built from the same docs the chips are built
	// FROM, so the round trip (resolve the chip through the library) cannot
	// link a doc the player is not looking at.
	const careerCatalog: PackChipDoc[] = startingDocs.map((doc) => ({
		key: String(doc.system?.key ?? ""),
		name: doc.name ?? "",
		uuid: doc.uuid ?? "",
	}));
	const careerOptions = careersForSpecies(startingDocs, state.speciesKey).map(
		(doc) => {
			const key = String(doc.system?.key ?? "");
			return {
				key,
				label: doc.name ?? key,
				selected: state.careerKey === key,
				suggested: suggested.has(key),
				// Bead hjve: the chip's pack-doc anchor, resolved through the
				// library (key-first against the careers catalog above).
				link: packDocAnchor({ key, name: doc.name ?? key }, careerCatalog, []),
			};
		},
	);
	return {
		careers: careerOptions,
		careerLabel: careerOptions.find((career) => career.selected)?.label ?? "",
	};
}

/**
 * Species step (bead ghmn): every option comes from the careers pack's
 * species blocks, plus the human default. The chosen species supplies the
 * stage-1 characteristic bases and its printed Fate/Wounds rules.
 */
export function buildSpeciesOptions(
	state: CreatorState,
	options: SpeciesOption[],
	localize: LocalizeFn,
): {
	speciesOptions: Array<Record<string, unknown>>;
	speciesLabel: string;
	speciesFateFormula: string;
	speciesWoundsFormula: string;
	speciesFate: number;
} {
	const speciesOptions = options.map((option) => ({
		key: option.key,
		label: option.key
			? option.label || option.key
			: localize("CREATOR.SPECIES_HUMAN"),
		selected: state.speciesKey === option.key,
	}));
	return {
		speciesOptions,
		speciesLabel: speciesOptions.find((option) => option.selected)?.label ?? "",
		speciesFateFormula: state.speciesFateFormula,
		speciesWoundsFormula: state.speciesWoundsFormula,
		speciesFate: state.speciesFate,
	};
}

/** A starting-acquisition chip (moved back from the lost splice — bead hldm). */
export interface AcqOption {
	/** Stable chip key (pack + name); payloads live with the application. */
	key: string;
	name: string;
	payload: object;
	tooltip: string;
	group: string;
	/** Weapon-training gate (book p272 bullet 2): false = not selectable. */
	selectable: boolean;
	selected: boolean;
}

/** A starting-acquisition candidate, as far as the pure builder reads it. */
export interface AcqDocLike {
	name?: string;
	type?: string;
	flags?: Record<string, Record<string, unknown>>;
	system?: {
		availability?: string;
		class?: string;
		weaponFamily?: string;
		source?: { book?: string };
		description?: string;
	};
	toObject: () => object;
}

/**
 * Stage 6 (gjvg): the starting free acquisition chips — items with a total
 * modifier of +0 or better need no test (Core Rulebook printed p272).
 * Availability modifier ≥ 0 (scarce+). The weapon gate is enforced at CLASS
 * level (the weapon schema has no family field) — see the caller's comment.
 *
 * Pure: the caller fetches the equipment pack + the weapon-training
 * coverage and supplies `readSource` so the doc→bucket step needs no
 * Foundry flag reader. Returns the chip rows AND the payload map (full
 * item JSON never goes through the DOM — the old data-payload attribute
 * broke on JSON quotes, "the fix that selection up" bug).
 */
export function buildAcquisitions(
	docs: AcqDocLike[],
	coverage: WeaponTrainingCoverage,
	selectedKey: string,
	readSource: (doc: AcqDocLike) => string,
	localize: LocalizeFn,
): { options: AcqOption[]; payloads: Map<string, object> } {
	const payloads = new Map<string, object>();
	const options: AcqOption[] = [];
	for (const doc of docs) {
		if (!doc.name) continue;
		// Acquisition buckets (bead n7hu): six packs became one `equipment`
		// pack, so bucket by the build-time source flag. The Tau armoury is
		// hand-authored mixed-type, so it buckets by item type; heirlooms and
		// cybernetics are not acquisitions.
		const source = readSource(doc);
		const group =
			source === "tau-armoury"
				? doc.type === "armour"
					? "armour"
					: doc.type === "gear"
						? "gear"
						: "weapons"
				: source === "weapons" ||
						source === "armour" ||
						source === "gear" ||
						source === "drugs" ||
						source === "tools"
					? source
					: null;
		if (!group) continue;
		const modifier = availabilityModifier(doc.system?.availability ?? "");
		if (modifier === null || modifier < 0) continue;
		const key = `${source}::${doc.name}`;
		const payload = doc.toObject() as object;
		payloads.set(key, payload);
		const isWeapon =
			doc.type === "melee-weapon" || doc.type === "ranged-weapon";
		const selectable =
			!isWeapon ||
			isTrainedFor(coverage, {
				class: doc.system?.class,
				weaponFamily: doc.system?.weaponFamily,
				name: doc.name,
				source: doc.system?.source,
			});
		options.push({
			key,
			name: `${doc.name} (${localize("CREATOR.ACQ_MODIFIER")} ${modifier >= 0 ? "+" : ""}${modifier})`,
			payload,
			tooltip: (doc.system?.description ?? "").slice(0, 300),
			group,
			selectable,
			selected: selectedKey === key,
		});
	}
	return {
		options: options.sort((a, b) =>
			String(a.name).localeCompare(String(b.name)),
		),
		payloads,
	};
}

/**
 * Stage 6 grouped view (bead a2rd, owner: collapsible groups): the flat
 * ~100+ chip list bucketed by item type, alphabetical WITHIN each group.
 * Groups start collapsed; a group containing the current selection always
 * renders open so the choice stays visible.
 */
export function buildAcquisitionGroups(
	items: Array<Record<string, unknown>>,
	acqCollapsed: Record<string, boolean>,
): Array<{
	key: string;
	labelKey: string;
	count: number;
	open: boolean;
	items: Array<Record<string, unknown>>;
}> {
	const GROUPS: Array<{ key: string; labelKey: string }> = [
		{ key: "weapons", labelKey: "CREATOR.ACQ_GROUP_WEAPONS" },
		{ key: "armour", labelKey: "CREATOR.ACQ_GROUP_ARMOUR" },
		{ key: "gear", labelKey: "CREATOR.ACQ_GROUP_GEAR" },
		{ key: "drugs", labelKey: "CREATOR.ACQ_GROUP_DRUGS" },
		{ key: "tools", labelKey: "CREATOR.ACQ_GROUP_TOOLS" },
	];
	return GROUPS.map(({ key, labelKey }) => {
		const list = items
			.filter((item) => (item.group ?? "gear") === key)
			.sort((a, b) => String(a.name).localeCompare(String(b.name)));
		return {
			key,
			labelKey,
			count: list.length,
			open: !acqCollapsed[key] || list.some((item) => Boolean(item.selected)),
			items: list,
		};
	});
}

/** Stage 3.5 (bead rboc): the heirloom panel's state. The roll applies only
 * when the Pride motivation's "Heirloom Item" alternative was taken. */
export function buildHeirloom(state: CreatorState): {
	enabled: boolean;
	rolled: { roll: number; name: string } | null;
} {
	const pridePick = state.picks.motivation;
	return {
		enabled: pridePick?.key === "pride" && pridePick.alternate === 0,
		rolled: state.heirloom,
	};
}

/** Display name for a kit option chip (craftsmanship + quantity hints). */
export function kitOptionName(opt: {
	name?: string;
	note?: boolean;
	craftsmanship?: string;
	quantity?: number;
}): string {
	const name = String(opt.name ?? "");
	const cs = opt.craftsmanship
		? `${opt.craftsmanship[0]?.toUpperCase() ?? ""}${opt.craftsmanship.slice(1)}-Craftsmanship `
		: "";
	const qty = Number(opt.quantity ?? 1) > 1 ? ` ×${opt.quantity}` : "";
	return `${cs}${name}${qty}`;
}

/**
 * Starting Kit (owner rework 2026, step 5): the career's kit row from the
 * pack; alternative slots become pick-one chip rows. `complete` gates
 * Create only when the career HAS a kit at all.
 */
export function buildKitContext(state: CreatorState): object {
	const kit = gearsetFor(state.careerKey);
	return kit
		? {
				present: true,
				label: kit.label,
				quote: kit.quote,
				slots: (kit.slots ?? []).map((slot: GearsetSlot, index: number) => ({
					index,
					count: slot.options?.length ?? 0,
					quote: slot.quote ?? "",
					options: (slot.options ?? []).map((opt, optIndex) => ({
						index: optIndex,
						name: kitOptionName(opt),
						selectable: true,
						selected:
							state.kitPicks[index] === optIndex ||
							(slot.options?.length === 1 &&
								state.kitPicks[index] === undefined),
					})),
				})),
				complete: kitChoicesComplete(kit, state.kitPicks),
			}
		: { present: false };
}

/**
 * The Create gate: every origin row picked, a career chosen, the point-buy
 * legal (method "roll" skips it), the kit's "or" slots resolved, and every
 * corruption-or-insanity track chosen (book rule — otherwise the rolled
 * dice would be silently dropped).
 */
export function buildCanCreate(
	state: CreatorState,
	originContexts: Array<{
		row: string;
		detail: { hasCorrIns?: boolean } | null;
	}>,
	pointBuy: ReturnType<typeof validatePointBuy>,
	kitComplete: boolean | undefined,
): boolean {
	const originRows = creatorOriginRows(state.speciesKey);
	return (
		originRows.every((row) => Boolean(state.picks[row])) &&
		Boolean(state.careerKey) &&
		(state.method === "roll" ? true : pointBuy.valid) &&
		// The kit's pick-one slots resolve (owner rework 2026): an unchosen
		// "or" group would otherwise grant a silent default.
		kitComplete !== false &&
		// Every origin whose mechanics offer the corruption-or-insanity
		// track must have the track chosen (book rule); otherwise the
		// rolled dice would be silently dropped.
		originRows.every((row) => {
			const pick = state.picks[row];
			if (!pick) return true;
			const detail = originContexts.find((r) => r.row === row)?.detail;
			if (!detail?.hasCorrIns) return true;
			return Boolean(state.corrOrInsTrack[row]);
		})
	);
}

// ---------------------------------------------------------------------------
// Bead 669h — grant reconciliation + summary card
// ---------------------------------------------------------------------------

/** An actor's item snapshot, as the reconcile reads it. */
export interface ExistingItemLike {
	id?: string;
	type?: string;
	name?: string;
	system?: { grantedBy?: string };
}

/**
 * Reconcile the creator-granted items against the OLD stored origin picks
 * (bead iufv: creator grants carry provenance; a re-run wipes ALL
 * creator-granted items and re-grants from the new picks — owner decision:
 * full wipe + re-grant. Manual items (no flag) are kept; pre-flag legacy
 * items are identified by name against the OLD picks and removed by this
 * first re-run (remove-then-regrant)).
 *
 * Bead 58js: reads BOTH halves of the stored picks through the shared
 * helper — the hand-rolled loop this replaces mapped only the five camelCase
 * human keys, so a xeno character's species-path picks were invisible to its
 * own reconcile as well as to the resolver.
 */
export function reconcileLegacyGrants(
	existing: ExistingItemLike[],
	oldOrigins: Record<string, string> | undefined,
): { deleteIds: string[] } {
	const legacyNames = new Set<string>();
	if (oldOrigins) {
		const oldPicks = storedOriginPicks(oldOrigins);
		if (Object.keys(oldPicks).length > 0) {
			const legacyResolved = resolveOrigins(oldPicks);
			for (const name of [
				...legacyResolved.skills,
				...legacyResolved.options,
				...legacyResolved.talents.filter((t) => !isUnresolvedChoice(t)),
			]) {
				legacyNames.add(name);
			}
		}
	}
	const { deleteIds } = reconcileForCreator(
		existing.map((item) => ({
			id: item.id,
			type: item.type,
			name: item.name,
			system: { grantedBy: item.system?.grantedBy },
		})),
		legacyNames,
	);
	return { deleteIds };
}

/** The summary-card builder's input: the picks as they stood at finish. */
export interface SummaryCardInput {
	/** The actor's display name (the card's heading). */
	name: string;
	speciesKey: string;
	picks: Partial<Record<OriginRow, OriginPick>>;
	careerKey: string;
}

/**
 * The finish summary-chat-card HTML (bead ay0: the card is the table-talk
 * record; the Background tab is the persisted record — bead tgq9, the card
 * only points there instead of duplicating origin trait notes).
 *
 * Pure: translations arrive through a `localize` seam (presentation
 * localizes, domain never — docs/ARCHITECTURE.md).
 */
export function buildSummaryCard(
	input: SummaryCardInput,
	resolved: ResolvedOrigin,
	localize: LocalizeFn,
): string {
	const rows = creatorOriginRows(input.speciesKey)
		.map((rowKey) => {
			const pick = input.picks[rowKey];
			const entry = pick ? originByKey(pick.key) : undefined;
			const variant = pick?.variantKey
				? entry?.variants?.find((v) => v.key === pick.variantKey)?.name
				: null;
			const label = localize(ORIGIN_ROW_LABEL_KEYS[rowKey]);
			return `<li><strong>${label}:</strong> ${entry?.name ?? "—"}${variant ? ` (${variant})` : ""}</li>`;
		})
		.join("");
	// Origin trait notes live on the Background tab now (tgq9) — the card
	// only points there.
	const notes = `<p>${localize("CREATOR.NOTES_POINTER")}</p>`;
	const pf = resolved.profitFactor
		? `<p>${localize("CREATOR.PROFIT_FACTOR")}: ${resolved.profitFactor > 0 ? "+" : ""}${resolved.profitFactor}</p>`
		: "";
	const initiative = resolved.initiativeBonus
		? `<p>${localize("CREATOR.INIT_BONUS")}: +${resolved.initiativeBonus}</p>`
		: "";
	// Psyker note (bead m4me): Astropaths (Psy Rating 2) and Navigators.
	const psykerNote =
		input.careerKey === "astropath-transcendent" ||
		input.careerKey === "navigator"
			? `<p>${localize("CREATOR.PSYKER")}${
					input.careerKey === "astropath-transcendent"
						? ` — ${localize("CREATOR.PSY_RATING_2")}`
						: ""
				}</p>`
			: "";
	return `<div class="rogue-trader creator-summary"><h3>${input.name}</h3><ul>${rows}</ul>${pf}${initiative}${psykerNote}${notes}</div>`;
}

/**
 * Catalog-matched skill grants for the resolved origin (the grant-step loop
 * head — bead 656m: mapped by the SHARED builder; only name/characteristic
 * feed matchOriginSkills).
 */
export function originSkillGrants(
	resolved: ResolvedOrigin,
	catalog: CatalogSkill[],
) {
	return matchOriginSkills(resolved, catalog);
}
