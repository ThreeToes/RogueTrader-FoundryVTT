import { coveringRow } from "../../../ffg/domain/model/chart";

/** Look up the covering row of a track/trauma table (pure). */
export function lookupMadnessRow(
	rows: Array<{
		kind?: string;
		rollMin?: number;
		rollMax?: number;
		degree?: string;
	}>,
	kind: string,
	d100: number,
): { degree: string } | null {
	const row = coveringRow(rows, kind, d100);
	if (!row) return null;
	return { degree: row.degree ?? "" };
}
