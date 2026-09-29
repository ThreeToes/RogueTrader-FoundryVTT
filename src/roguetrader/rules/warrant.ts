/**
 * Ship & Warrant Path (Into the Storm Chapter I, printed pp33-45) — pure
 * machinery, mirroring the Origin Path (rules/origins.ts).
 *
 * The option CONTENT (name, verbatim prose, Ship Points / Profit Factor)
 * lives in the private `warrant` compendium pack; this module keeps only the
 * row order, the runtime pool, the adjacency helper and the resolver. Adding
 * or editing an option is a pack edit, never a code edit.
 *
 * Chart adjacency (p33): the first row is completely open. Every later choice
 * must be the option directly below the previous pick or one of its two
 * horizontal neighbours — the chart is a single global column grid, so
 * Acquisition's 7 options simply span columns 0-6 while the other rows use
 * 1-5. Edge options therefore have fewer choices, and p33 adds that
 * Acquisition's Exile and Reward are extreme enough to have exactly ONE
 * choice below. Verified against the book's own worked example (Age of
 * Redemption col2 -> Rising Star/Ascending/Stable; Rising Star col1 -> Exile
 * col0; Exile col0 -> Halo Artefacts only; Reward col6 -> Age of Plunder
 * only).
 */

import { ChartPool } from "../../ffg/domain/model/chart";
import { nested, num, packSystem, str, strArray } from "../data/pack-fields";

export type WarrantRow =
	| "warrant-age"
	| "fortune-fate"
	| "acquisition"
	| "sanction"
	| "contacts"
	| "renown";

/** Row order down the chart (p33-44). */
export const WARRANT_ROWS: WarrantRow[] = [
	"warrant-age",
	"fortune-fate",
	"acquisition",
	"sanction",
	"contacts",
	"renown",
];

/** i18n key for each row's step label. */
export const WARRANT_ROW_LABEL_KEYS: Record<WarrantRow, string> = {
	"warrant-age": "WARRANT.ROW_WARRANT_AGE",
	"fortune-fate": "WARRANT.ROW_FORTUNE_FATE",
	acquisition: "WARRANT.ROW_ACQUISITION",
	sanction: "WARRANT.ROW_SANCTION",
	contacts: "WARRANT.ROW_CONTACTS",
	renown: "WARRANT.ROW_RENOWN",
};

/** Machine-applicable mechanics of one warrant option. */
export interface WarrantMechanics {
	shipPoints?: number;
	profitFactor?: number;
	/**
	 * Rules the engine cannot apply automatically (the Archeotech / Xenostech
	 * component grants). Prefixed with the option name and surfaced to the
	 * player at the end of the creator — never silently dropped.
	 */
	notes?: string[];
}

export interface WarrantEntry {
	key: string;
	row: WarrantRow;
	/** Column index on the p34 chart; adjacency uses this. */
	col: number;
	name: string;
	/** Verbatim book prose for the option. */
	description: string;
	mechanics: WarrantMechanics;
}

const warrantPool = new ChartPool<WarrantEntry>(WARRANT_ROWS);

/**
 * THE pack-document -> WarrantEntry mapping (bead 5rk0), shared by the ready
 * pack warmer (bootstrap/warmers) and the creator's on-demand pool fill
 * (sheet/actor/warrant-creator) so the schema only has one copy. Style
 * mirrors the other warmers (pack-fields helpers). Returns null for a doc
 * missing its `key` or carrying a `row` outside the chart — the same docs the
 * original warmWarrant filter and creator `toEntry` both dropped.
 */
export function warrantEntryFromDoc(doc: {
	name?: string | null;
	system?: unknown;
}): WarrantEntry | null {
	const s = packSystem(doc);
	const key = str(s, "key");
	const row = str(s, "row");
	if (!key || !isWarrantRow(row)) return null;
	const mechanics = nested(s, "mechanics");
	return {
		key,
		row,
		col: num(s, "col"),
		name: doc.name ?? "",
		description: str(s, "description"),
		mechanics: {
			shipPoints: num(mechanics, "shipPoints"),
			profitFactor: num(mechanics, "profitFactor"),
			notes: strArray(mechanics, "notes"),
		},
	};
}

/** Replace the runtime chart pool (pack loader / tests). */
export function setWarrantEntries(entries: WarrantEntry[]): void {
	warrantPool.set(entries);
}

/** The current runtime chart pool. */
export function getWarrantEntries(): WarrantEntry[] {
	return [...warrantPool.all()];
}

export function isWarrantRow(value: string): value is WarrantRow {
	return warrantPool.isRow(value);
}

export function warrantByKey(key: string): WarrantEntry | undefined {
	return warrantPool.byKey(key);
}

/** Every entry in a row, ordered by column. */
export function warrantInRow(row: WarrantRow): WarrantEntry[] {
	return warrantPool.inRow(row);
}

/** Distinct occupied columns of a row (a row may leave gaps). */
export function warrantRowColumns(row: WarrantRow): number[] {
	return warrantPool.rowColumns(row);
}

/**
 * Which columns of `row` are reachable from the previous pick at `prevCol`
 * (p33: the choice directly below, or either adjacent neighbour). The first
 * row is completely open. The adjacency lives in ChartPool (bead 8hkq).
 */
export function allowedWarrantColumns(
	row: WarrantRow,
	prevCol: number | null,
): number[] {
	return warrantPool.allowedColumns(row, prevCol);
}

/**
 * The column of a row's stored pick (its WarrantEntry), or null when the row
 * is unpicked or its key is unknown to the runtime pool. Shared by the
 * creator and the dynasty sheet (bead 6yz8) so a pick's column is resolved
 * exactly one way.
 */
export function warrantPickColumn(
	picks: Record<string, string>,
	row: WarrantRow,
): number | null {
	const key = picks[row];
	if (!key) return null;
	const entry = getWarrantEntries().find((e) => e.row === row && e.key === key);
	return entry ? entry.col : null;
}

/**
 * Prune any pick at/after `fromRow` that the (changed) pick at `fromRow`
 * makes unreachable, so the stored path is always legal. Walks the rows after
 * `fromRow` in order: a missing pick resets the anchor to null; a pick whose
 * entry is missing or whose column is not in allowedWarrantColumns(row,
 * prevCol) is dropped and resets the anchor. Returns a NEW picks record (the
 * input is not mutated).
 */
export function pruneWarrantPicks(
	picks: Record<string, string>,
	fromRow: WarrantRow,
): Record<string, string> {
	const pruned: Record<string, string> = { ...picks };
	let prevCol = warrantPickColumn(pruned, fromRow);
	for (let i = WARRANT_ROWS.indexOf(fromRow) + 1; i < WARRANT_ROWS.length; i++) {
		const row = WARRANT_ROWS[i];
		if (!pruned[row]) {
			prevCol = null;
			continue;
		}
		const entry = getWarrantEntries().find(
			(e) => e.row === row && e.key === pruned[row],
		);
		if (!entry || !allowedWarrantColumns(row, prevCol).includes(entry.col)) {
			delete pruned[row];
			prevCol = null;
			continue;
		}
		prevCol = entry.col;
	}
	return pruned;
}

export interface WarrantPick {
	row: WarrantRow;
	key: string;
}

export interface ResolvedWarrant {
	/** Resolved picks, in the order supplied (unknown picks dropped). */
	picks: WarrantPick[];
	shipPoints: number;
	profitFactor: number;
	/** Manual-application notes, each prefixed with its option name. */
	notes: string[];
	/** Chosen Warrant Renown option name (row 6), blank if none. */
	renown: string;
}

/**
 * Sum the picks into the dynasty's starting Ship Points / Profit Factor.
 * Unknown or mismatched picks are IGNORED (never thrown): stored data from a
 * pack revision that dropped an option must not break the sheet.
 */
export function resolveWarrant(
	picks: Array<{ row: string; key: string }>,
): ResolvedWarrant {
	let shipPoints = 0;
	let profitFactor = 0;
	let renown = "";
	const notes: string[] = [];
	const resolved: WarrantPick[] = [];
	for (const pick of picks) {
		if (!isWarrantRow(pick.row)) continue;
		const entry = warrantByKey(pick.key);
		if (!entry || entry.row !== pick.row) continue;
		resolved.push({ row: entry.row, key: entry.key });
		shipPoints += entry.mechanics.shipPoints ?? 0;
		profitFactor += entry.mechanics.profitFactor ?? 0;
		for (const note of entry.mechanics.notes ?? []) {
			if (note) notes.push(`${entry.name}: ${note}`);
		}
		if (entry.row === "renown") renown = entry.name;
	}
	return { picks: resolved, shipPoints, profitFactor, notes, renown };
}
