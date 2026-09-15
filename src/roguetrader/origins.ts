/**
 * Origin Path (epic 1gb7, Core Rulebook Chapter I p16-35) — pure machinery.
 *
 * The chart CONTENT (each option's name/description/effect/mechanics/variants)
 * now lives in the private `origins` compendium pack
 * (src/packs/rogue_trader/origins/origins.yaml, one `origin` Item per option)
 * so the verbatim book text never ships in system code — the extraction
 * convention. This module keeps:
 *   - the shared types (creator + pack loader);
 *   - the runtime pool, warmed from the pack at ready (setOriginEntries);
 *   - the pure graph/mechanics helpers (adjacency, dice, fate, merge).
 *
 * Chart adjacency (p16): each row after the first allows the selection
 * directly below the previous pick, or either horizontal neighbour of it.
 * Column layout verified against the book's own example (Void Born ->
 * Scapegrace | Scavenger | Stubjack; edge Scavenger -> Tainted | Criminal)
 * and the p16 chart grid.
 *
 * Anything the engine cannot resolve yet (mutation table rolls, vendetta
 * enemies, heirloom items, bionic upgrades...) stays in `notes`/prose and is
 * surfaced to the player at the end of the creator — never silently dropped.
 */

import type { CharacteristicKey } from "./data/actor/character";

export type OriginRow =
	| "home-world"
	| "birthright"
	| "lure"
	| "trials"
	| "motivation"
	// Non-human path rows (bead ghmn). Xenos do NOT use the Origin Path: Into
	// the Storm p48 says "Kroot characters do not use the Origin Path (except at
	// the GM's discretion)", and p49 replaces it with a single Kindred choice.
	// So a species' path is whatever rows ITS OWN entries declare.
	| "kindred"
	// Ork path (Into the Storm p61-62, "ORK ORIGINS"): Da Klan and Orky
	// Know-Wotz, one choice from each.
	| "klan"
	| "know-wotz";

/** Characteristic modifier: signed delta applied to the base roll. */
export interface CharMod {
	key: CharacteristicKey;
	value: number;
}

/**
 * Machine-applicable mechanics of one origin option (or variant). Book text
 * that needs GM/player adjudication lands in `notes` instead.
 */
export interface OriginMechanics {
	characteristics?: CharMod[];
	/** Player picks one group of characteristic modifiers (e.g. "+3 WP or +3 Fel"). */
	characteristicChoice?: CharMod[][];
	/** Player picks one whole alternative mechanics blob ("-3 Fellowship OR -1 Fate Point"). */
	alternateChoice?: Array<{ label: string; mechanics: OriginMechanics }>;

	/** Granted skills, verbatim book notation ("Speak Language (Ship Dialect)"). */
	skills?: string[];
	/** Granted talents, verbatim book notation ("Quick Draw"). */
	talents?: string[];
	/** Player picks one entry — mixed skill/talent options ("Logic OR Peer (Academic)"). */
	optionChoice?: string[];
	/** Wounds dice added to 2xTB, book notation (e.g. "1d5+2"). */
	woundsDice?: string;
	/** Flat wound bonus (Motivation: Endurance +1 Wound). */
	woundBonus?: number;
	/** d10 fate table: highest inclusive roll -> value. */
	fateTable?: Array<{ max: number; value: number }>;
	/** Flat fate-point delta (Ship-lorn -1, Fated for Greatness +1, Fortune +1). */
	fateDelta?: number;
	insanity?: number;
	insanityDice?: string;
	corruption?: number;
	corruptionDice?: string;
	/** Player chooses which track takes the dice (Scavenger/Scapegrace 1d5). */
	corruptionOrInsanityDice?: string;
	initiativeBonus?: number;
	profitFactor?: number;
	/** Rules the engine cannot resolve; shown for manual application. */
	notes?: string[];
}

/** A choose-one sub-result row (Criminal, Renegade, Tainted, Zealot...). */
export interface OriginVariant {
	key: string;
	name: string;
	/** Verbatim book effect text for this sub-result. */
	effect: string;
	mechanics: OriginMechanics;
}

export interface OriginEntry {
	key: string;
	row: OriginRow;
	/** Column index (0-based) on the p16 chart; adjacency uses this. */
	col: number;
	/**
	 * Species this entry belongs to (bead ghmn); blank = human. The creator's
	 * Origin step shows a species ONLY its own rows, so a Kroot is never offered
	 * a human Home World.
	 */
	species?: string;
	/**
	 * Core origin key this entry may be taken INSTEAD of (bead b03f). Splatbook
	 * alternates reuse a core column rather than widening the chart.
	 */
	replaces?: string;
	name: string;
	/** Flavour prose (verbatim, trimmed). */
	description: string;
	/** Effect text (verbatim) for options without variants. */
	effect?: string;
	mechanics: OriginMechanics;
	variants?: OriginVariant[];
}

/** Chart row order, top (Home World) to bottom (Motivation). */
export const ORIGIN_ROWS: OriginRow[] = [
	"home-world",
	"birthright",
	"lure",
	"trials",
	"motivation",
];

/**
 * Rows that belong to a non-human path (bead ghmn). Kept separate from
 * ORIGIN_ROWS so the human chart's five rows stay exactly five, and appended to
 * ROW_ORDER only for ordering purposes.
 */
export const XENO_ORIGIN_ROWS: OriginRow[] = ["kindred", "klan", "know-wotz"];

/** Canonical row order across every path (human first, then xeno rows). */
const ROW_ORDER: OriginRow[] = [...ORIGIN_ROWS, ...XENO_ORIGIN_ROWS];

export const ORIGIN_ROW_LABEL_KEYS: Record<OriginRow, string> = {
	"home-world": "ORIGIN.ROW_HOME_WORLD",
	birthright: "ORIGIN.ROW_BIRTHRIGHT",
	lure: "ORIGIN.ROW_LURE",
	trials: "ORIGIN.ROW_TRIALS",
	motivation: "ORIGIN.ROW_MOTIVATION",
	kindred: "ORIGIN.ROW_KINDRED",
	klan: "ORIGIN.ROW_KLAN",
	"know-wotz": "ORIGIN.ROW_KNOW_WOTZ",
};

// ---------------------------------------------------------------- Runtime pool

/**
 * The chart pool, warmed from the `origins` compendium pack at ready (epic
 * 1gb7). Empty until then and in pure unit tests; tests/worlds call
 * setOriginEntries. The pack is the source of truth.
 */
let originPool: OriginEntry[] = [];

/** Replace the runtime chart pool (pack loader / tests). */
export function setOriginEntries(entries: OriginEntry[]): void {
	originPool = entries;
}

/** The current runtime chart pool. */
export function getOriginEntries(): OriginEntry[] {
	return originPool;
}

/** A path entry's species binding: blank = human. */
export function speciesKeyOfEntry(entry: {
	species?: string;
}): string {
	return (entry?.species ?? "").trim();
}

/** All known rows across every path (validation helper for stored data). */
export function isOriginRow(value: string): value is OriginRow {
	return ROW_ORDER.includes(value as OriginRow);
}

/**
 * The Origin rows a species actually uses, DERIVED FROM THE PACK (bead ghmn).
 * The human path is the five core rows; a xeno species' path is whatever its
 * own entries declare — Kroot entries declare a single "kindred" row, and
 * Into the Storm p48 is explicit that they "do not use the Origin Path".
 *
 * A species with no entries yet (Orks, Dark Eldar — content not extracted)
 * yields [], so the creator shows no path rather than wrongly showing the
 * human chart.
 */
export function originRowsForSpecies(speciesKey: string): OriginRow[] {
	const want = (speciesKey ?? "").trim();
	const present = new Set<OriginRow>();
	for (const entry of originPool) {
		if (speciesKeyOfEntry(entry) !== want) continue;
		present.add(entry.row);
	}
	return ROW_ORDER.filter((row) => present.has(row));
}

// Suggested Home Worlds (Core Rulebook Table 1-1, p24) moved onto the Career
// item model (`system.suggestedHomeWorlds`, epic 1gb7 follow-up) — the creator
// reads them from the `careers` pack, so careers and their origin suggestions
// stay one document.

// ---------------------------------------------------------------- Pure helpers

export function originByKey(key: string): OriginEntry | undefined {
	return originPool.find((entry) => entry.key === key);
}

export function originsInRow(row: OriginRow): OriginEntry[] {
	return originPool
		.filter((entry) => entry.row === row)
		.sort((a, b) => a.col - b.col);
}

/**
 * Which columns of `row` are reachable from the previous pick at `prevCol`
 * (p16: the choice directly below, or either adjacent neighbour of it). The
 * first row is completely open.
 */
export function allowedColumns(row: OriginRow, prevCol: number | null): number[] {
	// DISTINCT columns (bead b03f): a splatbook alternate reuses a core column
	// (it "may be taken instead of" that entry), so counting entries would make
	// a five-column row look like it had six choices and would corrupt the
	// +/-1 adjacency below.
	const cols = [...new Set(originsInRow(row).map((entry) => entry.col))].sort(
		(a, b) => a - b,
	);
	if (prevCol === null) return cols;
	return cols.filter((col) => Math.abs(col - prevCol) <= 1);
}

/** Total characteristic modifiers from a mechanics blob (choice already made). */
export function characteristicDeltas(
	mechanics: OriginMechanics,
	chosenChoice?: CharMod[],
	chosenVariant?: OriginVariant,
): Partial<Record<CharacteristicKey, number>> {
	const effective = chosenVariant ? chosenVariant.mechanics : mechanics;
	const deltas: Partial<Record<CharacteristicKey, number>> = {};
	for (const mod of effective.characteristics ?? []) {
		deltas[mod.key] = (deltas[mod.key] ?? 0) + mod.value;
	}
	for (const mod of chosenChoice ?? []) {
		deltas[mod.key] = (deltas[mod.key] ?? 0) + mod.value;
	}
	return deltas;
}

/**
 * Evaluate a book dice-notation string of the form used by the Origin Path
 * ("1d5", "1d5+2", "2d10", "1d10+1"). Pure: takes a roll function so the
 * creator can pass foundry.dice.Roll and tests a deterministic roller.
 */
export function evaluateOriginDice(
	notation: string,
	roll: (faces: number, count: number) => number,
): number {
	const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(notation.replace(/\s/g, ""));
	if (!match) return 0;
	const count = Number(match[1]);
	const faces = Number(match[2]);
	const flat = match[3] ? Number(match[3]) : 0;
	let total = flat;
	for (let i = 0; i < count; i += 1) total += roll(faces, count);
	return total;
}

/** Roll a fate-points value from a home world's d10 table. */
export function fateFromTable(
	table: Array<{ max: number; value: number }>,
	d10: number,
): number {
	for (const band of table) {
		if (d10 <= band.max) return band.value;
	}
	return table.length > 0 ? table[table.length - 1].value : 0;
}

/** The active mechanics for an entry: the chosen variant's, or the entry's. */
export function effectiveMechanics(
	entry: OriginEntry,
	variantKey?: string,
): OriginMechanics {
	if (!variantKey || !entry.variants) return entry.mechanics;
	return entry.variants.find((v) => v.key === variantKey)?.mechanics ?? entry.mechanics;
}

// ---------------------------------------------------------------- Resolution

/** One row's selection made in the creator. */
export interface OriginPick {
	key: string;
	/** Chosen sub-result variant key (entries with variants). */
	variantKey?: string;
	/** Chosen option from `optionChoice`. */
	optionChoice?: string;
	/** Chosen group from `characteristicChoice`. */
	charChoice?: CharMod[];
	/** Chosen index from `alternateChoice`. */
	alternate?: number;
}

/** Fully merged mechanics across all five rows (choices already made). */
export interface ResolvedOrigin {
	characteristics: Partial<Record<CharacteristicKey, number>>;
	skills: string[];
	talents: string[];
	/** Chosen options that may be either a skill or a talent (match at grant time). */
	options: string[];
	/** Book dice notation added to 2xTB, one per source. */
	woundsDice: string[];
	woundBonus: number;
	/** d10 fate table from the Home World (null when absent). */
	fateTable: Array<{ max: number; value: number }> | null;
	fateDelta: number;
	insanity: number;
	insanityDice: string[];
	corruption: number;
	corruptionDice: string[];
	/** Player chose which track takes these dice (tracked separately at apply time). */
	corruptionOrInsanityDice: string[];
	initiativeBonus: number;
	profitFactor: number;
	/** Rules needing manual application, with source attribution. */
	notes: string[];
}

export function resolveOrigins(
	picks: Partial<Record<OriginRow, OriginPick>>,
): ResolvedOrigin {
	const resolved: ResolvedOrigin = {
		characteristics: {},
		skills: [],
		talents: [],
		options: [],
		woundsDice: [],
		woundBonus: 0,
		fateTable: null,
		fateDelta: 0,
		insanity: 0,
		insanityDice: [],
		corruption: 0,
		corruptionDice: [],
		corruptionOrInsanityDice: [],
		initiativeBonus: 0,
		profitFactor: 0,
		notes: [],
	};

	const addChars = (mods: CharMod[]) => {
		for (const mod of mods) {
			resolved.characteristics[mod.key] =
				(resolved.characteristics[mod.key] ?? 0) + mod.value;
		}
	};
	const absorb = (label: string, m: OriginMechanics) => {
		addChars(m.characteristics ?? []);
		resolved.skills.push(...(m.skills ?? []));
		resolved.talents.push(...(m.talents ?? []));
		if (m.woundsDice) resolved.woundsDice.push(m.woundsDice);
		resolved.woundBonus += m.woundBonus ?? 0;
		if (m.fateTable) resolved.fateTable = m.fateTable;
		resolved.fateDelta += m.fateDelta ?? 0;
		resolved.insanity += m.insanity ?? 0;
		if (m.insanityDice) resolved.insanityDice.push(m.insanityDice);
		resolved.corruption += m.corruption ?? 0;
		if (m.corruptionDice) resolved.corruptionDice.push(m.corruptionDice);
		if (m.corruptionOrInsanityDice)
			resolved.corruptionOrInsanityDice.push(m.corruptionOrInsanityDice);
		resolved.initiativeBonus += m.initiativeBonus ?? 0;
		resolved.profitFactor += m.profitFactor ?? 0;
		for (const note of m.notes ?? []) resolved.notes.push(`[${label}] ${note}`);
	};

	for (const row of ORIGIN_ROWS) {
		const pick = picks[row];
		if (!pick) continue;
		const entry = originByKey(pick.key);
		if (!entry || entry.row !== row) continue;
		const label = entry.name;
		const mechanics = effectiveMechanics(entry, pick.variantKey);
		absorb(label, mechanics);
		// Alternate choice replaces/extends with one whole blob.
		if (
			mechanics.alternateChoice &&
			pick.alternate !== undefined &&
			mechanics.alternateChoice[pick.alternate]
		) {
			const alt = mechanics.alternateChoice[pick.alternate];
			absorb(`${label}: ${alt.label}`, alt.mechanics);
		}
		// Characteristic choice: exactly one group.
		if (
			mechanics.characteristicChoice &&
			pick.charChoice
		) {
			addChars(pick.charChoice);
		}
		// Option choice may be a skill or a talent; the caller matches it
		// against the skill catalog first, then the talents pack.
		if (mechanics.optionChoice && pick.optionChoice) {
			resolved.options.push(pick.optionChoice);
		}
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Table 1-2: Heirloom Items (Core Rulebook p31; epic 1gb7 follow-up). The
// per-heirloom content (key, 1d100 range, grant payload) now lives in the
// private `heirlooms` compendium pack; the verbatim prose stays in the
// `creationtables` RollTable "Table 1-2: Heirloom Items", whose result flags
// carry the matching `key`. This module keeps the shared types, the runtime
// pool (warmed from the pack at ready), and the 1d100 lookup.
//
// Curation (owner-verify, carried from bead rboc): the book grants a generic
// Best-Craftsmanship chainsword / carapace set; the packs model them as the
// Hecate chainsword and Storm Trooper Carapace full set, cloned + renamed.
// ---------------------------------------------------------------------------
export type HeirloomGrantKind = "pack-item" | "note-item";

export interface HeirloomGrant {
	kind: HeirloomGrantKind;
	/** pack-item: compendium pack id to clone from. */
	pack?: string;
	/** pack-item: source item name in that pack. */
	item?: string;
	/** pack-item: craftsmanship override (e.g. "best"). */
	craftsmanship?: string;
	/** pack-item: rename the clone (the book's own item name). */
	rename?: string;
	/** note-item: description for the granted special-ability item. */
	noteText?: string;
}

export interface HeirloomEntry {
	/** Stable slug; matches the source RollTable result's item flag. */
	key: string;
	name: string;
	/** 1d100 range of the source table row. */
	range: [number, number];
	/** Source RollTable ("creationtables/Table 1-2: Heirloom Items"). */
	table?: string;
	grant: HeirloomGrant;
}

/** Runtime heirloom pool (warmed from the `heirlooms` pack at ready). */
let heirloomPool: HeirloomEntry[] = [];

/** Replace the runtime heirloom pool (pack loader / tests). */
export function setHeirloomEntries(entries: HeirloomEntry[]): void {
	heirloomPool = entries;
}

/** The current runtime heirloom pool. */
export function getHeirloomEntries(): HeirloomEntry[] {
	return heirloomPool;
}

/** The heirloom entry for a 1d100 result; loud failure outside 1-100. */
export function heirloomForRoll(roll: number): HeirloomEntry {
	const n = Math.floor(roll);
	const entry = heirloomPool.find((e) => n >= e.range[0] && n <= e.range[1]);
	if (!entry) throw new Error(`Heirloom roll ${n} outside Table 1-2 (1-100)`);
	return entry;
}
