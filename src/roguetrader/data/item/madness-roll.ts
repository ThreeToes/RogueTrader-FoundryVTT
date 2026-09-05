/** Look up the covering row of a track/trauma table (pure). */
export function lookupMadnessRow(
	rows: Array<{ kind?: string; rollMin?: number; rollMax?: number; degree?: string }>,
	kind: string,
	d100: number,
): { degree: string } | null {
	const candidates = rows.filter(
		(row) =>
			row.kind === kind &&
			d100 >= (row.rollMin ?? 0) &&
			d100 <= (row.rollMax ?? 999),
	);
	if (candidates.length === 0) return null;
	return { degree: candidates[0].degree ?? "" };
}