/**
 * Origin Path (epic 1gb7, Core Rulebook Chapter I p16-35) — pure machinery.
 *
 * The chart CONTENT (each option's name/description/effect/mechanics/variants)
 * now lives in the private `origins` compendium pack
 * (src/packs/rogue_trader/character-options/origins.yaml, one `origin` Item per option)
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

import type { CharacteristicKey } from "../data/actor/character";
import {
	nested,
	num,
	optionalStr,
	str,
	type PackSystem,
} from "../data/pack-fields";
import { ChartPool } from "../domain/model/chart";

export type OriginRow =
	| "home-world"
	| "birthright"
	| "lure"
	| "trials"
	| "motivation"
	// Into the Storm p28: Lineage is a SIXTH human row, chosen freely after
	// the other five (bead b03f).
	| "lineage"
	// Non-human path rows (bead ghmn). Xenos do NOT use the Origin Path: Into
	// the Storm p48 says "Kroot characters do not use the Origin Path (except at
	// the GM's discretion)", and p49 replaces it with a single Kindred choice.
	// So a species' path is whatever rows ITS OWN entries declare.
	| "kindred"
	// Ork path (Into the Storm p61-62, "ORK ORIGINS"): Da Klan and Orky
	// Know-Wotz, one choice from each.
	| "klan"
	| "know-wotz"
	// Tau path (Tau Character Guide p7-8): "A Tau Explorer must choose from one of
	// the six following Classified Competencies at character creation."
	| "competence";

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
	/**
	 * Experience-point cost deducted from starting xp (bead b03f). Into the
	 * Storm's expanded Origin Path options each cost xp (p17: "each selection
	 * costs a listed number of experience points"); the core chart has none.
	 */
	xpCost?: number;
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
	 * Core origin key(s) this entry may be taken INSTEAD of (bead b03f).
	 * Splatbook alternates reuse a core column rather than widening the chart;
	 * an expanded entry may substitute EITHER of two core entries (Into the
	 * Storm p17 "instead of the Scavenger or Savant entry"), hence the array.
	 */
	replaces?: string | string[];
	name: string;
	/** Flavour prose (verbatim, trimmed). */
	description: string;
	/** Effect text (verbatim) for options without variants. */
	effect?: string;
	mechanics: OriginMechanics;
	variants?: OriginVariant[];
}

/** Chart row order, top (Home World) to bottom (Motivation then Lineage). */
export const ORIGIN_ROWS: OriginRow[] = [
	"home-world",
	"birthright",
	"lure",
	"trials",
	"motivation",
	"lineage",
];

/**
 * Rows that belong to a non-human path (bead ghmn). Kept separate from
 * ORIGIN_ROWS so the human chart's five rows stay exactly five, and appended to
 * ROW_ORDER only for ordering purposes.
 */
export const XENO_ORIGIN_ROWS: OriginRow[] = [
	"kindred",
	"klan",
	"know-wotz",
	"competence",
];

/**
 * Canonical row order across every path (human first, then xeno rows).
 *
 * THIS IS THE VOCABULARY EVERY ROW-AWARE FIELD MUST USE. `ORIGIN_ROWS` is the
 * HUMAN path only — using it as a whole-chart vocabulary is the bug that made
 * every xeno entry collapse onto Home World (2026-09-20): the `row` DataModel
 * field's `choices` was built from `ORIGIN_ROWS`, so Foundry coerced the four
 * xeno rows to the field's initial and the human chart rendered all 35 entries.
 */
export const ORIGIN_ROW_ORDER: OriginRow[] = [
	...ORIGIN_ROWS,
	...XENO_ORIGIN_ROWS,
];

/**
 * The `choices` vocabulary for the `row` DataModel field: EVERY path's rows.
 *
 * Shared with data/item/origin.ts and with the tests ON PURPOSE. Building the
 * list inline from `ORIGIN_ROWS` is what broke the creator (2026-09-20): a
 * `choices` list narrower than the data silently coerces every
 * out-of-vocabulary value to the field's `initial`, so all four xeno rows
 * became "home-world" and the human chart rendered all 35 entries. The test
 * asserts this vocabulary covers every row the pack actually uses.
 */
export function originRowChoices(): Record<string, string> {
	return Object.fromEntries(ORIGIN_ROW_ORDER.map((row) => [row, row]));
}

export const ORIGIN_ROW_LABEL_KEYS: Record<OriginRow, string> = {
	"home-world": "ORIGIN.ROW_HOME_WORLD",
	birthright: "ORIGIN.ROW_BIRTHRIGHT",
	lure: "ORIGIN.ROW_LURE",
	trials: "ORIGIN.ROW_TRIALS",
	motivation: "ORIGIN.ROW_MOTIVATION",
	lineage: "ORIGIN.ROW_LINEAGE",
	kindred: "ORIGIN.ROW_KINDRED",
	klan: "ORIGIN.ROW_KLAN",
	"know-wotz": "ORIGIN.ROW_KNOW_WOTZ",
	competence: "ORIGIN.ROW_COMPETENCE",
};

// ---------------------------------------------------------------- Runtime pool

/**
 * The chart pool, warmed from the `origins` compendium pack at ready (epic
 * 1gb7). Empty until then and in pure unit tests; tests/worlds call
 * setOriginEntries. The pack is the source of truth.
 */
const originPool = new ChartPool<OriginEntry>(ORIGIN_ROW_ORDER);

/** Replace the runtime chart pool (pack loader / tests). */
export function setOriginEntries(entries: OriginEntry[]): void {
	originPool.set(entries);
}

/** The current runtime chart pool. */
export function getOriginEntries(): OriginEntry[] {
	return [...originPool.all()];
}

/** The loose `system` block of an `origin` pack document. */
export interface OriginDocSystem {
	key?: unknown;
	row?: unknown;
	col?: unknown;
	species?: unknown;
	replaces?: unknown;
	description?: unknown;
	effect?: unknown;
	mechanics?: unknown;
	variants?: unknown;
}

/**
 * Map one `origin` pack document onto the runtime entry (bead ghmn).
 *
 * PURE, and shared with the ready-time warmer ON PURPOSE. The warmer used to
 * build this object inline and silently omitted `species` and `replaces`, so at
 * runtime every entry looked human — the creator offered every species' rows on
 * the human Origin Path (bug report 2026-09-20) — and the b03f
 * alternate-substitution logic was dead. A shared mapper plus a test over the
 * real pack is what makes that omission impossible.
 *
 * Every field the chart logic reads must be carried here; `originEntryFromDoc`
 * is the only place a pack document becomes an entry.
 */
export function originEntryFromDoc(doc: {
	name?: string;
	system?: unknown;
}): OriginEntry {
	const s = (doc.system ?? {}) as OriginDocSystem & PackSystem;
	return {
		key: str(s, "key"),
		row: str(s, "row", "home-world") as OriginRow,
		col: num(s, "col"),
		// Species binding: blank = the human Origin Path (bead ghmn).
		species: optionalStr(s, "species"),
		// Alternate substitution (bead b03f): a core key, or an array of them.
		replaces: Array.isArray(s.replaces)
			? (s.replaces as string[])
			: optionalStr(s, "replaces"),
		name: doc.name ?? "",
		description: str(s, "description"),
		effect: optionalStr(s, "effect"),
		mechanics: nested(s, "mechanics") as OriginMechanics,
		variants: Array.isArray(s.variants)
			? (s.variants as OriginVariant[])
			: undefined,
	};
}

/** A path entry's species binding: blank = human. */
export function speciesKeyOfEntry(entry: {
	species?: string;
}): string {
	return (entry?.species ?? "").trim();
}

/** All known rows across every path (validation helper for stored data). */
export function isOriginRow(value: string): value is OriginRow {
	return originPool.isRow(value);
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
	for (const entry of originPool.all()) {
		if (speciesKeyOfEntry(entry) !== want) continue;
		present.add(entry.row);
	}
	return ORIGIN_ROW_ORDER.filter((row) => present.has(row));
}

// Suggested Home Worlds (Core Rulebook Table 1-1, p24) moved onto the Career
// item model (`system.suggestedHomeWorlds`, epic 1gb7 follow-up) — the creator
// reads them from the `careers` pack, so careers and their origin suggestions
// stay one document.

// ---------------------------------------------------------------- Pure helpers

export function originByKey(key: string): OriginEntry | undefined {
	return originPool.byKey(key);
}

/** Core origin keys an entry may substitute, normalised to an array. */
export function replacedKeys(entry: {
	replaces?: string | string[];
}): string[] {
	const value = entry?.replaces;
	if (!value) return [];
	return Array.isArray(value) ? value.filter(Boolean) : [value];
}

/**
 * Every chart column an entry may occupy: its own, plus those of any core
 * entry it "may be taken instead of". Into the Storm's expanded entries span
 * two core slots (Fringe Survivor for Scavenger OR Savant, p17), so a single
 * stored column would leave half its legal positions unusable (bead b03f).
 */
export function entryColumns(entry: OriginEntry): number[] {
	const cols = new Set<number>([entry.col]);
	for (const key of replacedKeys(entry)) {
		const core = originByKey(key);
		if (core) cols.add(core.col);
	}
	return [...cols];
}

export function originsInRow(row: OriginRow): OriginEntry[] {
	return originPool.inRow(row);
}

/**
 * Which columns of `row` are reachable from the previous pick at `prevCol`
 * (p16: the choice directly below, or either adjacent neighbour of it). The
 * first row is completely open.
 */
export function allowedColumns(row: OriginRow, prevCol: number | null): number[] {
	// Lineage is NOT part of the constrained chart (Into the Storm p28:
	// "Lineage choices are free and open, not constrained by the other choices
	// of the Origin Path"), so every slot is reachable. The adjacency itself
	// lives in ChartPool (bead 8hkq).
	return originPool.allowedColumns(row, prevCol, row === "lineage");
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

/** One pick as it is STORED on the actor (bead 58js). */
export interface StoredOriginPick {
	/** Chart row key (klan, know-wotz, competence, kindred). */
	row: string;
	/** Chart entry key. */
	key: string;
	variantKey?: string;
}

/** `Character.system.origins`, as far as the chart cares. */
export interface StoredOrigins {
	homeWorld?: string;
	birthright?: string;
	lure?: string;
	trials?: string;
	motivation?: string;
	/** Species-path picks; the five fields above are the fixed human shape. */
	path?: StoredOriginPick[];
}

/** The stored shape `storedOriginsFromPicks` produces. */
export interface StoredOriginsPayload {
	homeWorld: string;
	birthright: string;
	lure: string;
	trials: string;
	motivation: string;
	path: Array<{ row: string; key: string; variantKey: string }>;
}

/** The five string fields of `StoredOriginsPayload`/`StoredOrigins` (everything but `path`). */
type StoredHumanField =
	| "homeWorld"
	| "birthright"
	| "lure"
	| "trials"
	| "motivation";

/** The five fixed human fields, in chart order. */
const STORED_HUMAN_FIELDS: ReadonlyArray<
	readonly [StoredHumanField, OriginRow]
> = [
	["homeWorld", "home-world"],
	["birthright", "birthright"],
	["lure", "lure"],
	["trials", "trials"],
	["motivation", "motivation"],
];

/**
 * Read `system.origins` as a picks map, whichever half a pick lives in.
 *
 * THE single reader for stored picks (bead 58js). A human character's picks are
 * the five named fields; a species path's are the `path` array. Callers must
 * not read either half directly: reading only the five named fields is exactly
 * how a xeno's picks were invisible to the resolver, to trait resolution and to
 * the creator's own reconcile.
 */
export function storedOriginPicks(
	origins: StoredOrigins | undefined | null,
): Partial<Record<OriginRow, OriginPick>> {
	const picks: Partial<Record<OriginRow, OriginPick>> = {};
	if (!origins) return picks;
	for (const [field, row] of STORED_HUMAN_FIELDS) {
		const stored = origins[field];
		if (typeof stored !== "string" || !stored) continue;
		// The five fields carry variants as "key|variantKey" (bead ay0).
		const [key, variantKey] = stored.split("|");
		picks[row] = { key, ...(variantKey ? { variantKey } : {}) };
	}
	for (const pick of origins.path ?? []) {
		if (!pick?.key || !isOriginRow(pick.row)) continue;
		picks[pick.row] = {
			key: pick.key,
			...(pick.variantKey ? { variantKey: pick.variantKey } : {}),
		};
	}
	return picks;
}

/**
 * Write a picks map back to the stored shape: the five named human fields (with
 * their existing "key|variantKey" convention) plus `path` for every other row.
 */
export function storedOriginsFromPicks(
	picks: Partial<Record<OriginRow, OriginPick>>,
): StoredOriginsPayload {
	const stored: StoredOriginsPayload = {
		homeWorld: "",
		birthright: "",
		lure: "",
		trials: "",
		motivation: "",
		path: [],
	};
	const humanField = new Map<OriginRow, StoredHumanField>(
		STORED_HUMAN_FIELDS.map(([field, row]) => [row, field]),
	);
	for (const [row, pick] of Object.entries(picks) as Array<
		[OriginRow, OriginPick]
	>) {
		if (!pick?.key) continue;
		const field = humanField.get(row);
		if (field) {
			stored[field] = pick.variantKey
				? `${pick.key}|${pick.variantKey}`
				: pick.key;
			continue;
		}
		stored.path.push({
			row,
			key: pick.key,
			variantKey: pick.variantKey ?? "",
		});
	}
	return stored;
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
	/** Experience-point cost deducted from starting xp (bead b03f). */
	xpCost: number;
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
		xpCost: 0,
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
		resolved.xpCost += m.xpCost ?? 0;
		for (const note of m.notes ?? []) resolved.notes.push(`[${label}] ${note}`);
	};

	// EVERY path's rows, not just the human five: a xeno pick (klan,
	// know-wotz, competence, kindred) carries mechanics too, and iterating only
	// ORIGIN_ROWS silently dropped them (bug 2026-09-20, same family as the
	// `row` choices bug).
	for (const row of ORIGIN_ROW_ORDER) {
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


