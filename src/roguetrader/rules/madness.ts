/**
 * Insanity & corruption mechanics (epic 1g2t) — PURE, data-in/data-out.
 * Track data lives in the rogue-trader.madness compendium (06qc/e6x9);
 * this module provides the book arithmetic over it:
 *
 * - Insanity Track (Table 10-5): degree + Trauma-test modifier per IP band;
 *   Disorders auto-granted at 40 (Minor), 60 (Severe), 80 (Acute) IP.
 * - Trauma Test (p296): Willpower test every +10 IP, modified by the track;
 *   failure rolls d100 +10 per Degree of Failure on Table 10-6.
 * - Corruption Track (Table 10-7): degree + Malignancy-test modifier per CP
 *   band; Malignancy Test (p299) every +10 CP; mutation test (two different
 *   characteristics) every +30 CP.
 *
 * Acquired afflictions (disorders/malignancies/mutations) persist on the
 * actor ledger (audit trail like the g7k advances).
 */

export interface TrackRowLike {
	kind?: string;
	rollMin?: number;
	rollMax?: number;
	degree?: string;
	modifier?: number;
}

function coveringRow(
	rows: TrackRowLike[],
	kind: string,
	points: number,
): TrackRowLike | null {
	return (
		rows.find(
			(row) =>
				row.kind === kind &&
				points >= (row.rollMin ?? 0) &&
				points <= (row.rollMax ?? 999),
		) ?? null
	);
}

/** Degree of Madness + Trauma-test modifier for an insanity total. */
export function insanityTrack(
	rows: TrackRowLike[],
	insanityPoints: number,
): { degree: string; modifier: number } {
	const row = coveringRow(rows, "insanity-track", insanityPoints);
	return {
		degree: row?.degree ?? "",
		modifier: row?.modifier ?? 0,
	};
}

/** Degree of Corruption + Malignancy-test modifier for a CP total. */
export function corruptionTrack(
	rows: TrackRowLike[],
	corruptionPoints: number,
): { degree: string; modifier: number } {
	const row = coveringRow(rows, "corruption-track", corruptionPoints);
	return {
		degree: row?.degree ?? "",
		modifier: row?.modifier ?? 0,
	};
}

/** Disorder thresholds (rt_core p296: 40 Minor, 60 Severe, 80 Acute). */
export const DISORDER_THRESHOLDS = [
	{ at: 40, severity: "Minor" },
	{ at: 60, severity: "Severe" },
	{ at: 80, severity: "Acute" },
] as const;

/**
 * Disorder grants due at a given insanity total, NOT yet in the ledger.
 * A character must hold the preceding severity for a disorder to worsen
 * ("The Flesh is Weak" has no Minor version — GM adjudication, noted).
 */
export function dueDisorders(
	insanityPoints: number,
	ledger: AfflictionLedgerEntry[],
): Array<{ at: number; severity: string }> {
	return DISORDER_THRESHOLDS.filter(
		(band) =>
			insanityPoints >= band.at &&
			!ledger.some(
				(entry) =>
					entry.kind === "disorder" && entry.name.startsWith(band.severity),
			),
	).map((band) => ({ ...band }));
}

/** Trauma-test roll on Table 10-6: d100 + 10 per Degree of Failure. */
export function traumaRoll(degreesOfFailure: number, d100: number): number {
	return d100 + 10 * Math.max(0, degreesOfFailure);
}

/** Malignancy tests due: one per full 10 CP above 0 (p299). */
export function malignancyTestsDue(corruptionPoints: number): number {
	return Math.floor(corruptionPoints / 10);
}

/** Mutation tests due: two-characteristic tests per full 30 CP (p299). */
export function mutationTestsDue(corruptionPoints: number): number {
	return Math.floor(corruptionPoints / 30);
}

// ---------------------------------------------------------------- Ledger

export type AfflictionKind = "disorder" | "malignancy" | "mutation";

/** One acquired affliction (actor ledger, g7k audit-trail pattern). */
export interface AfflictionLedgerEntry {
	kind: AfflictionKind;
	/** Row name ("Palsy", "Minor Disorder (Phobia)"...). */
	name: string;
	/** Severity when relevant (disorders). */
	severity?: string;
	/** Verbatim book text. */
	text: string;
}

export interface AfflictionsLike {
	afflictions?: AfflictionLedgerEntry[];
}

/** Append without duplication (same kind + name = already suffered). */
export function addAffliction(
	existing: AfflictionLedgerEntry[],
	entry: AfflictionLedgerEntry,
): AfflictionLedgerEntry[] {
	if (
		existing.some((e) => e.kind === entry.kind && e.name === entry.name)
	) {
		return existing;
	}
	return [...existing, entry];
}