/**
 * Chart pool (epic kof0, bead 8hkq): the shared machinery behind the
 * row-and-column choice charts.
 *
 * The Origin Path (Core Rulebook Ch. II) and the Ship & Warrant Path (Into the
 * Storm Ch. I) are the same shape: rows of options, each option in a column,
 * with a pick in one row constraining the next to the column directly below or
 * either adjacent neighbour. `origins.ts` and `rules/warrant.ts` implemented
 * that twice, by copy — this is the one implementation.
 *
 * Both charts keep their own named wrapper functions (`originsInRow`,
 * `allowedWarrantColumns`, …) because ~95 call sites use them; the point here
 * is that the ALGORITHM lives once, not that the vocabulary changes.
 *
 * Foundry-free: a pool is plain data, loaded from a compendium by the
 * composition root and read synchronously afterwards.
 */

/** Anything that can sit in a chart: a key, a row and a column. */
export interface ChartEntry {
	key: string;
	row: string;
	col: number;
}

/**
 * The entries of one chart, plus the row vocabulary that validates stored data.
 */
export class ChartPool<E extends ChartEntry> {
	readonly #rows: readonly string[];
	#entries: E[] = [];

	/** @param rows every row this chart defines, in chart order. */
	constructor(rows: readonly string[]) {
		this.#rows = rows;
	}

	/** Replace the pool (the pack loader, or a test). */
	set(entries: E[]): void {
		this.#entries = entries;
	}

	/** The current entries. */
	all(): readonly E[] {
		return this.#entries;
	}

	/** Is this a row of this chart? (Validation for stored picks.) */
	isRow(value: string): boolean {
		return this.#rows.includes(value);
	}

	/** The entry with this key, if present. */
	byKey(key: string): E | undefined {
		return this.#entries.find((entry) => entry.key === key);
	}

	/** Every entry in a row, ordered by column. */
	inRow(row: string): E[] {
		return this.#entries
			.filter((entry) => entry.row === row)
			.sort((a, b) => a.col - b.col);
	}

	/**
	 * Distinct occupied columns of a row. A row may leave gaps, and a splatbook
	 * alternate may reuse a core column (it "may be taken instead of" that
	 * entry), so counting entries rather than columns would make a five-column
	 * row look like it had six choices and corrupt the adjacency below.
	 */
	rowColumns(row: string): number[] {
		return [...new Set(this.inRow(row).map((entry) => entry.col))].sort(
			(a, b) => a - b,
		);
	}

	/**
	 * Which columns of `row` are reachable from the previous pick at `prevCol`:
	 * the choice directly below, or either adjacent neighbour. The first row
	 * (prevCol null) is completely open, and `alwaysOpen` marks a row the book
	 * exempts from the constraint entirely.
	 */
	allowedColumns(
		row: string,
		prevCol: number | null,
		alwaysOpen = false,
	): number[] {
		const cols = this.rowColumns(row);
		if (alwaysOpen || prevCol === null) return cols;
		return cols.filter((col) => Math.abs(col - prevCol) <= 1);
	}
}
