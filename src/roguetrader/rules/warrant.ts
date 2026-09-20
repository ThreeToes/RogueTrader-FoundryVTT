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

import { ChartPool } from "../domain/model/chart";

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
