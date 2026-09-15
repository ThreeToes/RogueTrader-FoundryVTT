/**
 * Mutation table rolls (beads bfdz / kam1). Pure: the roller is injected so
 * the table logic is unit-testable without Foundry.
 */

/**
 * The fields a table lookup needs. Deliberately structural (not a reference to
 * the Mutation document class) so this module stays dependency-free: the
 * Mutation model reaches it via rules/afflictions.ts, and importing the class
 * back would close a cycle.
 */
export interface MutationRow {
	name?: string;
	tableKey: string;
	rollMin: number;
	rollMax: number;
}

/** Roll on a mutation table (pure; roller injected for testability). */
export function rollMutation(
	rows: MutationRow[],
	tableKey: string,
	d100: number,
): { name: string } | null {
	const candidates = rows.filter(
		(row) =>
			row.tableKey === tableKey &&
			d100 >= row.rollMin &&
			d100 <= row.rollMax,
	);
	if (candidates.length === 0) return null;
	return { name: candidates[0].name ?? "" };
}

/**
 * One mutation gained by a Ravaged Body roll: the d100 that selected it and
 * the covering row's name. The roll is kept so the chat card can show what was
 * actually thrown, not just the outcome.
 */
export interface RavagedBodyRoll {
	roll: number;
	name: string;
}

/**
 * Ravaged Body (Core Rulebook p369): "Roll 1d5 times on this table."
 *
 * Rolls 1d5 for the number of additional mutations, then that many d100s,
 * returning the covering rows in roll order. Duplicates are kept: the book
 * says to roll N times, not to re-roll repeats, and inventing a re-roll
 * would silently change the printed odds.
 *
 * A re-rolled "Ravaged Body" comes back as an ordinary name. The CALLER
 * decides whether that recurses (see prepareDroppedItems' `fromTableRoll`
 * guard) — this helper stays a pure table lookup.
 *
 * Out-of-range results THROW rather than dropping a roll: a missing band means
 * the table is incomplete, and silently returning fewer mutations than the
 * dice said would be a silent rules change.
 */
export async function rollRavagedBody(
	rows: MutationRow[],
	roll: (notation: string) => Promise<number>,
	tableKey = "mutations",
): Promise<RavagedBodyRoll[]> {
	const times = await roll("1d5");
	if (!Number.isInteger(times) || times < 1 || times > 5) {
		throw new Error(`Ravaged Body count out of range (1d5 returned ${times})`);
	}
	const results: RavagedBodyRoll[] = [];
	for (let i = 0; i < times; i++) {
		const d100 = await roll("1d100");
		const row = rollMutation(rows, tableKey, d100);
		if (!row) {
			throw new Error(
				`Ravaged Body roll ${d100} has no covering row in table "${tableKey}"`,
			);
		}
		results.push({ roll: d100, name: row.name });
	}
	return results;
}
