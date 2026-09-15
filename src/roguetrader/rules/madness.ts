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
 * Acquired afflictions (disorders/malignancies/mutations) are OWNED ITEMS
 * (epic nt8k): their effects feed the item-effects funnel and the derived
 * handlers directly, and the Background tab groups them by kind. `dueDisorders`
 * reads the owned disorder items' gained severity, not a separate ledger.
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

/** A disorder already held at a severity (from an owned disorder Item). */
export interface HeldDisorderLike {
	severity?: string;
}

/**
 * Disorder grants due at a given insanity total, NOT yet held. Each acquired
 * disorder stores the severity it was gained at (MadnessEntry.acquiredSeverity),
 * so a Minor/Severe/Acute disorder suppresses its own threshold. A character
 * must hold the preceding severity for a disorder to worsen ("The Flesh is
 * Weak" has no Minor version — GM adjudication, noted).
 */
export function dueDisorders(
	insanityPoints: number,
	held: HeldDisorderLike[] = [],
): Array<{ at: number; severity: string }> {
	return DISORDER_THRESHOLDS.filter(
		(band) =>
			insanityPoints >= band.at &&
			!held.some((entry) => entry.severity === band.severity),
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

export type AfflictionKind = "disorder" | "malignancy" | "mutation";

/** Minimal shape of an owned affliction Item (mutation / madnessentry). */
export interface OwnedAfflictionLike {
	/** Item id, so an attack chip can target the owned item (bead kam1). */
	id?: string;
	name?: string;
	type?: string;
	system?: {
		kind?: string;
		description?: string;
		shortDescription?: string;
		/** Severity an acquired disorder was gained at (drop-time resolution). */
		acquiredSeverity?: string;
		/**
		 * Printed attack block (bead kam1). Present on mutations that ARE an
		 * attack (Corrosive Bile's BS test at 1d10+2 R (or E) Tearing).
		 */
		attack?: { damage?: string };
	};
}

// ---------------------------------------------------------------- Sheet

/**
 * Sheet context for the madness tracks + carried conditions (beads 1g2t +
 * q1ql, epic nt8k): shared by the background and combat tabs. PURE — takes
 * the cached pack rows, the track totals, the OWNED affliction Items, and a
 * structural actor; the sheet just spreads the result.
 */
export interface MadnessPoints {
	insanity?: number;
	corruption?: number;
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
	afflictions: OwnedAfflictionLike[],
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
		afflictionGroups: Array<{
			label: string;
			entries: Array<{
				id: string;
				name: string;
				severity: string;
				text: string;
				/** Owned mutation that is itself an attack (bead kam1). */
				canAttack: boolean;
			}>;
		}>;
	};
	conditions: { snapOutReady: boolean; carried: string[] };
} {
	const insanity = insanityTrack(rows, system.insanity ?? 0);
	const corr = corruptionTrack(rows, system.corruption ?? 0);
	const owned = afflictions ?? [];
	const ofType = (type: string, kind?: string) =>
		owned.filter(
			(item) =>
				item.type === type && (kind === undefined || item.system?.kind === kind),
		);
	const groupOf = (label: string, items: OwnedAfflictionLike[]) => ({
		label,
		entries: items.map((item) => ({
			id: item.id ?? "",
			name: item.name ?? "",
			severity: item.system?.acquiredSeverity ?? "",
			text: item.system?.description ?? item.system?.shortDescription ?? "",
			// A mutation whose printed attack block resolved to a profile
			// (bead kam1) gets a roll chip on its affliction row. `damage` is
			// the discriminator: an all-blank block means "no attack", so
			// prose that merely mentions combat does not become a button.
			canAttack: item.type === "mutation" && Boolean(item.system?.attack?.damage),
		})),
	});
	const disorders = ofType("madnessentry", "disorder");
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
			dueDisorders: dueDisorders(
				system.insanity ?? 0,
				disorders.map((item) => ({
					severity: item.system?.acquiredSeverity ?? "",
				})),
			),
			afflictionGroups: [
				groupOf("AFFLICTION.DISORDER", disorders),
				groupOf("AFFLICTION.MALIGNANCY", ofType("madnessentry", "malignancy")),
				groupOf("AFFLICTION.MUTATION", ofType("mutation")),
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
