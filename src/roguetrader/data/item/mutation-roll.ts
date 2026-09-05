/** Roll on a mutation table (pure; roller injected for testability). */
export function rollMutation(
	rows: Array<Pick<Mutation, "tableKey" | "rollMin" | "rollMax"> & { name?: string }>,
	tableKey: string,
	d100: number,
): { name: string } | null {
	const candidates = rows.filter(
		(row) => row.tableKey === tableKey && d100 >= row.rollMin && d100 <= row.rollMax,
	);
	if (candidates.length === 0) return null;
	return { name: candidates[0].name ?? "" };
}