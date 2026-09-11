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

/** Disorder thresholds (Core Rulebook p296: 40 Minor, 60 Severe, 80 Acute). */
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

/**
 * Next disorder threshold above `points` (40/60/80), or null once all are
 * passed — pure display helper for sheet progress (never stored).
 */
export function nextDisorderThreshold(insanityPoints: number): number | null {
	return (
		DISORDER_THRESHOLDS.find((band) => insanityPoints < band.at)?.at ?? null
	);
}

/**
 * Next mutation-test threshold above `points` (multiples of 30, capped at 90
 * — the track goes Damned at 100), or null; pure display helper.
 */
export function nextMutationThreshold(corruptionPoints: number): number | null {
	const next = (Math.floor(corruptionPoints / 30) + 1) * 30;
	return next <= 90 ? next : null;
}

import {
	carriedConditions,
	snapOutReady,
} from "./conditions";

/**
 * Which ledger kind a dropped pack item maps to (bead rdh1), or null when
 * the drop is an ordinary item copy: madness-pack disorders/malignancies
 * carry system.kind; mutation-pack rows carry tableKey "mutations".
 */
export function afflictionLedgerKind(source: {
	kind?: string;
	tableKey?: string;
}): AfflictionKind | null {
	if (source.kind === "disorder" || source.kind === "malignancy") {
		return source.kind;
	}
	if (source.tableKey === "mutations" || source.kind === "mutation") {
		return "mutation";
	}
	return null;
}

// ---------------------------------------------------------------- Ledger

/**
 * Sheet context for the madness tracks + carried conditions (beads 1g2t +
 * q1ql): shared by the background and combat tabs. PURE — takes the cached
 * pack rows and a structural actor; the sheet just spreads the result.
 */
export interface MadnessPoints {
	insanity?: number;
	corruption?: number;
	afflictions?: unknown;
}

interface ConditionsActorLike {
	effects?: Array<{
		id?: string;
		name?: string;
		statuses?: string[];
		flags?: { "rogue-trader"?: { snapOut?: boolean } };
	}>;
}

export function madnessSheetContext(
	rows: TrackRowLike[],
	system: MadnessPoints,
	actor: ConditionsActorLike,
): {
	madness: {
		insanityPoints: number;
		corruptionPoints: number;
		insanityDegree: string;
		insanityModifier: number;
		corruptionDegree: string;
		corruptionModifier: number;
		nextDisorder: number | null;
		nextMutation: number | null;
		dueDisorders: Array<{ at: number; severity: string }>;
		afflictions: AfflictionLedgerEntry[];
		afflictionGroups: Array<{
			label: string;
			entries: Array<{ name: string; severity: string; text: string }>;
		}>;
	};
	conditions: { snapOutReady: boolean; carried: string[] };
} {
	const insanity = insanityTrack(rows, system.insanity ?? 0);
	const corr = corruptionTrack(rows, system.corruption ?? 0);
	const ledger = (system.afflictions ?? []) as AfflictionLedgerEntry[];
	const byKind = (kind: AfflictionKind, label: string) => ({
		label,
		entries: ledger
			.filter((entry) => entry.kind === kind)
			.map((entry) => ({
				name: entry.name,
				severity: entry.severity ?? "",
				text: entry.text,
			})),
	});
	return {
		madness: {
			insanityPoints: system.insanity ?? 0,
			corruptionPoints: system.corruption ?? 0,
			insanityDegree: insanity.degree,
			insanityModifier: insanity.modifier,
			corruptionDegree: corr.degree,
			corruptionModifier: corr.modifier,
			nextDisorder: nextDisorderThreshold(system.insanity ?? 0),
			nextMutation: nextMutationThreshold(system.corruption ?? 0),
			dueDisorders: dueDisorders(system.insanity ?? 0, ledger),
			afflictions: ledger,
			afflictionGroups: [
				byKind("disorder", "AFFLICTION.DISORDER"),
				byKind("malignancy", "AFFLICTION.MALIGNANCY"),
				byKind("mutation", "AFFLICTION.MUTATION"),
			],
		},
		// Transient conditions (bead q1ql): the combat tab shows the snap-out
		// affordance only when a snap-out-capable status is carried.
		conditions: {
			snapOutReady: snapOutReady(actor),
			carried: carriedConditions(actor).map((c) => c.name),
		},
	};
}

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