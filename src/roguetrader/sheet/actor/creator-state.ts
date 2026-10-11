/**
 * PURE creator state + transitions (bead hldm): the CharacterCreator's
 * `CreatorState` shape, its `emptyState()` factory and every PICK/ROLL
 * transition the creator's handlers perform, as plain functions over plain
 * state — no Foundry globals, no ApplicationV2, no pack fetches.
 *
 * Extracted from the CharacterCreator god class so state and the code that
 * mutates it live together and unit-test headlessly: the dice arrive as an
 * injected Dice port, pack-driven decisions (species legality, career
 * suggestions) arrive as plain doc lists. The handlers in
 * character-creator.ts stay as the thin Foundry dispatch edge; they read
 * dataset attributes, call one transition, re-render.
 *
 * Tested by creator-state.test.ts (plain fixtures, no Foundry shim).
 */
import type { CharacteristicKey } from "../../data/actor/character";
import type { Dice } from "../../../ffg/application/ports";
import {
	type CharMod,
	type OriginPick,
	type OriginRow,
	isOriginRow,
	originRowsForSpecies,
	type ResolvedOrigin,
} from "../../rules/origins";
import {
	type FateBand,
	HUMAN_SPECIES_KEY,
	DEFAULT_SPECIES_WOUNDS,
	type SpeciesOption,
	type SpeciesSource,
	type SpeciesWoundsSpec,
	POINT_BUY_MAX,
	careersForSpecies,
} from "../../rules/creation";

/** Book order for the characteristics (Stage 1, Core Rulebook p14). */
export const CHARACTERISTIC_ORDER: CharacteristicKey[] = [
	"ws",
	"bs",
	"s",
	"t",
	"ag",
	"int",
	"per",
	"wp",
	"fel",
];

/**
 * The creator's persisted wizard state. Moved from the class (bead hldm)
 * with its builders; the shape is unchanged.
 */
export interface CreatorState {
	name: string;
	method: "roll" | "points";
	/**
	 * The species' per-characteristic 2d10 BASE (bead ghmn), copied from the
	 * careers compendium when a species is chosen. Human = 25 across, which is
	 * also the initial value, so an unchosen species behaves exactly as before.
	 */
	base: Record<CharacteristicKey, number>;
	/** Chosen species key ("" = human) + its pack label/formulas for display. */
	speciesKey: string;
	speciesLabel: string;
	speciesFate: number;
	speciesFateFormula: string;
	speciesWoundsFormula: string;
	/** Structured species starter-Fate bands (bead g45s); empty = fixed/none. */
	speciesFateBands: FateBand[];
	/** Structured species starter-Wounds spec (bead g45s). */
	speciesWounds: SpeciesWoundsSpec;
	allocated: Partial<Record<CharacteristicKey, number>>;
	rolled: Partial<Record<CharacteristicKey, number>>;
	rerollUsed: boolean;
	picks: Partial<Record<OriginRow, OriginPick>>;
	/** Track choice for corruptionOrInsanityDice, per row key. */
	corrOrInsTrack: Record<string, "corruption" | "insanity">;
	careerKey: string;
	/** Rolled totals for wounds/fate/insanity/corruption dice. */
	rolledDice: {
		wounds: number[];
		fateD10: number | null;
		/** Species-block wound dice (bead g45s); empty for the human path. */
		speciesWounds: number[];
		/** Species-block starting-Fate d10 (bead g45s). */
		speciesFateD10: number | null;
		insanity: number[];
		corruption: number[];
		corrOrInsanity: number[];
	};
	/** Stage 6: the starting free acquisition (item key + pack payload). */
	acquisition: { key: string; name: string; payload: object } | null;
	/** Stage 6 collapsed group state (bead a2rd): group key -> collapsed. */
	acqCollapsed: Record<string, boolean>;
	/** Stage 3.5 (bead rboc): rolled heirloom (1d100 result + entry name). */
	heirloom: { roll: number; name: string } | null;
	/**
	 * Starting Kit picks (owner rework 2026, step 5): per-slot option index —
	 * slot index -> chosen option index (the book's "or" groups). Fixed
	 * slots (one option) never need a pick; `kitPicks` records the chosen
	 * option slot anyway at grant (default 0).
	 */
	kitPicks: Record<number, number>;
}

export function emptyState(): CreatorState {
	return {
		name: "",
		method: "roll",
		base: {
			ws: 25,
			bs: 25,
			s: 25,
			t: 25,
			ag: 25,
			int: 25,
			per: 25,
			wp: 25,
			fel: 25,
		},
		allocated: {},
		rolled: {},
		speciesKey: HUMAN_SPECIES_KEY,
		speciesLabel: "",
		speciesFate: 0,
		speciesFateFormula: "",
		speciesWoundsFormula: "",
		speciesFateBands: [],
		speciesWounds: { ...DEFAULT_SPECIES_WOUNDS },
		rerollUsed: false,
		picks: {},
		corrOrInsTrack: {},
		careerKey: "",
		rolledDice: {
			wounds: [],
			fateD10: null,
			speciesWounds: [],
			speciesFateD10: null,
			insanity: [],
			corruption: [],
			corrOrInsanity: [],
		},
		acquisition: null,
		acqCollapsed: {},
		heirloom: null,
		kitPicks: {},
	};
}

/**
 * The target actor's prefill (bead hldm): existing characteristics roll
 * in as rolled values — the player can re-roll (book: one re-roll) or
 * switch to point-buy — and the stored career key carries over.
 */
export function prefillFromActor(
	state: CreatorState,
	actor: {
		system?: unknown;
	} | null,
): void {
	if (!actor?.system) return;
	const system = actor.system as unknown as {
		characteristics: Record<CharacteristicKey, { value: number }>;
		careerKey?: string;
	};
	state.careerKey = system.careerKey ?? "";
	for (const key of CHARACTERISTIC_ORDER) {
		state.rolled[key] = system.characteristics[key]?.value ?? 25;
	}
}

// ---------------------------------------------------------------------------
// Roll transitions (beads 71gm, nxok, moved in hldm)
// ---------------------------------------------------------------------------

/**
 * Shared creator helpers (beads 71gm and nxok): the characteristic dice
 * formula and the collapsible-group toggle, used by the sibling creators
 * (ship-creator imports these — they are the same patterns the ship wizard
 * mirrors). Deliberately Foundry-light: the dice come in as an injected
 * port so the formula is unit-testable headlessly.
 */

/** 2d10 + the species base for one characteristic (Stage 1, Core Rulebook p14). */
export async function rollCharacteristic(
	dice: Dice,
	state: { base: Record<CharacteristicKey, number> },
	key: CharacteristicKey,
): Promise<number> {
	return (await dice.roll(`2d10+${state.base[key]}`)).total ?? 0;
}

/** Stage 1 roll-all: every characteristic in book order. */
export async function rollAllCharacteristics(
	dice: Dice,
	state: { base: Record<CharacteristicKey, number> },
): Promise<Partial<Record<CharacteristicKey, number>>> {
	const rolled: Partial<Record<CharacteristicKey, number>> = {};
	for (const key of CHARACTERISTIC_ORDER) {
		rolled[key] = await rollCharacteristic(dice, state, key);
	}
	return rolled;
}

/**
 * Roll one characteristic into the state (the #onRollOne action's body).
 * The book grants a single re-roll per creator; `rerollCharacteristic`
 * consumes it, refusing twice and refusing an unrolled characteristic.
 */
export async function rollCharacteristicInto(
	state: CreatorState,
	dice: Dice,
	key: CharacteristicKey,
): Promise<void> {
	state.rolled[key] = await rollCharacteristic(dice, state, key);
}

export async function rerollCharacteristic(
	state: CreatorState,
	dice: Dice,
	key: CharacteristicKey,
): Promise<boolean> {
	if (state.rerollUsed) return false;
	if (!key || state.rolled[key] === undefined) return false;
	state.rolled[key] = await rollCharacteristic(dice, state, key);
	state.rerollUsed = true;
	return true;
}

/**
 * Toggle one collapsible group's state field (bead nxok): present =
 * collapsed, absent = open. The state record carries the per-group keys.
 */
export function toggleCollapse(
	state: object,
	field: string,
	key: string,
): void {
	const collapsed = (state as Record<string, Record<string, boolean>>)[field];
	if (!collapsed) return;
	if (collapsed[key]) delete collapsed[key];
	else collapsed[key] = true;
}

/**
 * Roll the origin-path AND species-block vitals dice into
 * state.rolledDice (the Review-step entry roll). A xeno's species block
 * carries its own Wounds dice and Fate bands (bead g45s); the human path
 * uses the chosen Origin rows instead. `roll` is the dice seam so this is
 * headlessly testable — the application passes its rolled-helper.
 */
export async function rollOriginDice(
	state: CreatorState,
	resolved: ResolvedOrigin,
	roll: (formula: string) => Promise<number>,
): Promise<void> {
	state.rolledDice = {
		wounds: [],
		fateD10: null,
		speciesWounds: [],
		speciesFateD10: null,
		insanity: [],
		corruption: [],
		corrOrInsanity: [],
	};
	for (const notation of resolved.woundsDice) {
		state.rolledDice.wounds.push(await roll(notation));
	}
	if (resolved.fateTable) state.rolledDice.fateD10 = await roll("1d10");
	if (state.speciesKey !== HUMAN_SPECIES_KEY) {
		if (state.speciesWounds.dice) {
			state.rolledDice.speciesWounds.push(await roll(state.speciesWounds.dice));
		}
		if (state.speciesFate <= 0 && state.speciesFateBands.length > 0) {
			state.rolledDice.speciesFateD10 = await roll("1d10");
		}
	}
	for (const notation of resolved.insanityDice) {
		state.rolledDice.insanity.push(await roll(notation));
	}
	for (const notation of resolved.corruptionDice) {
		state.rolledDice.corruption.push(await roll(notation));
	}
	for (const notation of resolved.corruptionOrInsanityDice) {
		state.rolledDice.corrOrInsanity.push(await roll(notation));
	}
}

// ---------------------------------------------------------------------------
// Pick transitions (the #on* action bodies, decoupled from the DOM)
// ---------------------------------------------------------------------------

/** Stage-1 method switch; anything not "points" is the roll method. */
export function setCreatorMethod(
	state: CreatorState,
	raw: string | undefined,
): void {
	state.method = raw === "points" ? "points" : "roll";
}

/** Point-buy allocation clamped to the book's +20 per-characteristic cap. */
export function allocatePointBuy(
	state: CreatorState,
	key: CharacteristicKey,
	delta: number,
): void {
	if (!key) return;
	const current = state.allocated[key] ?? 0;
	state.allocated[key] = Math.min(POINT_BUY_MAX, Math.max(0, current + delta));
}

/**
 * Pick (or clear, empty key) one Origin Path row. A NEW pick also clears
 * the row's corruption-or-insanity track choice — the track belongs to the
 * pick, so switching options must not keep the old row's track.
 */
export function chooseOriginRow(
	state: CreatorState,
	row: OriginRow,
	key: string,
): boolean {
	if (!row || !isOriginRow(row)) return false;
	if (!key) {
		delete state.picks[row];
	} else {
		state.picks[row] = { key };
		delete state.corrOrInsTrack[row];
	}
	return true;
}

export type PickOptionKind = "variant" | "option" | "charChoice" | "alternate";

/** A sub-result pick (variant / player option / char group / alternate). */
export function choosePickOption(
	state: CreatorState,
	row: OriginRow,
	kind: string | undefined,
	value: string | undefined,
): boolean {
	const pick = state.picks[row];
	if (!pick) return false;
	const v = value ?? "";
	if (kind === "variant") pick.variantKey = v || undefined;
	else if (kind === "option") pick.optionChoice = v || undefined;
	else if (kind === "charChoice")
		pick.charChoice = v ? (JSON.parse(v) as CharMod[]) : undefined;
	else if (kind === "alternate")
		pick.alternate = v === "" ? undefined : Number(v);
	else return false;
	return true;
}

/** The corruption-or-insanity track choice for a rolled dice row. */
export function chooseCorrInsTrack(
	state: CreatorState,
	row: OriginRow,
	track: string | undefined,
): boolean {
	if (!row || (track !== "corruption" && track !== "insanity")) return false;
	state.corrOrInsTrack[row] = track;
	return true;
}

/** Career chips are a free choice (Core Rulebook p24). */
export function chooseCreatorCareer(state: CreatorState, key: string): void {
	state.careerKey = key ?? "";
}

/** Starting Kit: toggle the pick-one slot's chosen option (re-click clears). */
export function toggleKitSlotPick(
	state: CreatorState,
	slot: number,
	option: number,
): boolean {
	if (!Number.isInteger(slot)) return false;
	if (
		{}.hasOwnProperty.call(state.kitPicks, slot) &&
		state.kitPicks[slot] === option
	) {
		delete state.kitPicks[slot];
	} else {
		state.kitPicks[slot] = option;
	}
	return true;
}

/** A careers-pack document, as far as the legality check reads it. */
export interface CareerDocLike {
	name?: string;
	/** Pack document uuid (bead hjve): the career chip's doc link. */
	uuid?: string;
	system?: {
		key?: string;
		suggestedHomeWorlds?: string[];
		/** Verbatim alternate/elite gate; blank = a starting career. */
		requiredCareer?: string;
		species?: SpeciesSource;
	};
}

/**
 * Species choice (bead ghmn). Everything the step needs comes from the
 * chosen pack option: the per-characteristic base used by BOTH stage-1
 * methods, and the printed Fate/Wounds rules shown on review. Changing
 * species therefore invalidates rolled values and any career that is no
 * longer legal, so both are cleared rather than left stale.
 *
 * Returns false only when the same species is re-chosen — the caller must
 * not re-render a no-op (matching the original handler's early return).
 */
export function chooseSpecies(
	state: CreatorState,
	option: SpeciesOption,
	startingCareerDocs: CareerDocLike[],
): boolean {
	if (state.speciesKey === option.key) return false;
	state.speciesKey = option.key;
	state.speciesLabel = option.label;
	state.base = { ...option.base };
	state.speciesFate = option.startingFate;
	state.speciesFateFormula = option.fateFormula;
	state.speciesWoundsFormula = option.woundsFormula;
	state.speciesFateBands = [...option.fateBands];
	state.speciesWounds = { ...option.wounds };
	// The bases changed, so any roll taken at the old base is meaningless.
	state.rolled = {};
	state.rerollUsed = false;
	// Species paths differ (bead ghmn): drop picks whose row the new species
	// does not have, or a Kroot would carry human Home World/Birthright picks
	// into a path that has no such rows.
	const rows = new Set(originRowsForSpecies(option.key));
	for (const row of Object.keys(state.picks) as OriginRow[]) {
		if (!rows.has(row)) {
			delete state.picks[row];
			delete state.corrOrInsTrack[row];
		}
	}
	// Drop a career the new species cannot take.
	if (state.careerKey) {
		const legal = careersForSpecies(startingCareerDocs, option.key).some(
			(doc) => String(doc.system?.key ?? "") === state.careerKey,
		);
		if (!legal) state.careerKey = "";
	}
	return true;
}
