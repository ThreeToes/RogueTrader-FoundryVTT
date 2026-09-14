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
	| "motivation";

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

export const ORIGIN_ROW_LABEL_KEYS: Record<OriginRow, string> = {
	"home-world": "ORIGIN.ROW_HOME_WORLD",
	birthright: "ORIGIN.ROW_BIRTHRIGHT",
	lure: "ORIGIN.ROW_LURE",
	trials: "ORIGIN.ROW_TRIALS",
	motivation: "ORIGIN.ROW_MOTIVATION",
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

export const SUGGESTED_HOME_WORLDS: Record<string, string[]> = {
	"arch-militant": ["death-world", "forge-world", "hive-world", "void-born"],
	"astropath-transcendent": ["hive-world", "imperial-world", "void-born"],
	explorator: ["forge-world", "hive-world", "imperial-world", "void-born"],
	missionary: ["death-world", "hive-world", "imperial-world", "noble-born"],
	navigator: ["hive-world", "imperial-world", "noble-born", "void-born"],
	"rogue-trader": ["hive-world", "imperial-world", "noble-born", "void-born"],
	seneschal: ["hive-world", "imperial-world", "noble-born", "void-born"],
	"void-master": ["forge-world", "hive-world", "void-born"],
};

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
	const rowEntries = originsInRow(row);
	const cols = rowEntries.map((entry) => entry.col);
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
// Table 1-2: Heirloom Items (Core Rulebook p31, layout pp30-31; bead rboc).
// Rolled by the creator's stage 3.5 when the Pride motivation's "Heirloom
// Item" alternative is taken. 1d100 ranges are the book's own (five wide
// ranges, not 100 distinct rows). Prose is verbatim from the book; grant
// payloads map each row onto existing pack data — curation decisions:
//   * Angevin Era Chainsword: the book grants a generic Best-Craftsmanship
//     chainsword; the weapons pack's chainsword is the Hecate pattern, used
//     as the clone base and renamed (owner-verify).
//   * Saint-blessed Carapace Armour: the book grants a full Best-Craftsmanship
//     carapace set; the armour pack models it as the Storm Trooper Carapace
//     full set, used as the clone base and renamed (owner-verify).
// ---------------------------------------------------------------------------
export type HeirloomGrant =
	| {
			kind: "pack-item";
			pack: string;
			item: string;
			craftsmanship?: string;
			rename?: string;
	  }
	| { kind: "note-item"; system: Record<string, unknown> };

export interface HeirloomEntry {
	name: string;
	range: [number, number];
	/** Verbatim book prose. */
	text: string;
	grant: HeirloomGrant;
}

export const heirloomItems: HeirloomEntry[] = [
	{
		name: "Archeotech Laspistol",
		range: [1, 20],
		text: "Archeotech Laspistol: A weapon of unknown origin and great antiquity. You gain one best-Craftsmanship archeotech laspistol.",
		grant: {
			kind: "pack-item",
			pack: "rogue-trader.weapons",
			item: "Archeotech Laspistol",
			craftsmanship: "best",
		},
	},
	{
		name: "Angevin Era Chainsword",
		range: [21, 40],
		text: "Angevin Era Chainsword: An ancient blade bearing Crusade purity seals and kill-marks, supposedly used against dire xenos in the cleansing of the Drusus Marches. You gain one Best-Craftsmanship chainsword.",
		grant: {
			kind: "pack-item",
			pack: "rogue-trader.weapons",
			item: "Chainsword (Hecate)",
			craftsmanship: "best",
			rename: "Angevin Era Chainsword",
		},
	},
	{
		name: "Ancestral Seal",
		range: [41, 60],
		text: "Ancestral Seal: A potent and respected mark of power once held, passed down through a family even after their scions have long departed the vaults of Imperial rulership. You gain a +10% bonus to all Interaction Skill Tests when displaying the seal and dealing with Imperial citizens or organisations.",
		grant: {
			kind: "note-item",
			system: {
				description:
					"A potent and respected mark of power once held, passed down through a family even after their scions have long departed the vaults of Imperial rulership. You gain a +10% bonus to all Interaction Skill Tests when displaying the seal and dealing with Imperial citizens or organisations. (Core Rulebook Table 1-2, p31; conditional bonus — apply manually.)",
			},
		},
	},
	{
		name: "Saint-blessed Carapace Armour",
		range: [61, 80],
		text: "Saint-blessed Carapace Armour: A set of armour that once belonged to a saint's honour-guard. Anointed and inscribed with the saint's teachings, it is a sign to stir the faithful of the Imperial Creed. You gain one best-Craftsmanship set of carapace armour.",
		grant: {
			kind: "pack-item",
			pack: "rogue-trader.armour",
			item: "Storm Trooper Carapace",
			craftsmanship: "best",
			rename: "Saint-blessed Carapace Armour",
		},
	},
	{
		name: "Reliquary of Saint Drusus",
		range: [81, 100],
		text: "Reliquary of Saint Drusus: An inscribed void-steel canister containing a true relic of the saint, attested to in Ecclesiarchy data-vaults. Such an artefact opens many doors in the Ministorum. You gain a +20% bonus to all Interaction Skill Tests when displaying the reliquary and dealing with any member of the Ministorum.",
		grant: {
			kind: "note-item",
			system: {
				description:
					"An inscribed void-steel canister containing a true relic of the saint, attested to in Ecclesiarchy data-vaults. Such an artefact opens many doors in the Ministorum. You gain a +20% bonus to all Interaction Skill Tests when displaying the reliquary and dealing with any member of the Ministorum. (Core Rulebook Table 1-2, p31; conditional bonus — apply manually.)",
			},
		},
	},
];

/** The heirloom entry for a 1d100 result; loud failure outside 1-100. */
export function heirloomForRoll(roll: number): HeirloomEntry {
	const n = Math.floor(roll);
	const entry = heirloomItems.find((e) => n >= e.range[0] && n <= e.range[1]);
	if (!entry) throw new Error(`Heirloom roll ${n} outside Table 1-2 (1-100)`);
	return entry;
}
