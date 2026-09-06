/**
 * Psyker mechanics (bead sa6, Core Rulebook Ch. VI). Pure + Foundry-free.
 *
 * Book citations (verified against the Core Rulebook PDF during bead 5p15):
 * - Table 6-1 Psychic Strength (book p157): Fettered = PR/2 (round up),
 *   never phenomena; Unfettered = PR, doubles on the Focus Power Test roll
 *   Psychic Phenomena; Push = PR +1..+3/+4, phenomena roll automatic with
 *   +5 per +1 PR pushed.
 * - Focus Power Test (book p157): Characteristic (usually Willpower) or
 *   Skill (usually Psyniscience); +5 to the Characteristic per level of
 *   effective Psy Rating; 91+ always fails.
 * - Sustaining (book p157): +10 to all Phenomena rolls and -1 effective PR
 *   per sustained power; maintaining 2+ powers drops effective PR by 2 (3
 *   by 3, ...); +10 to the phenomena chart result per additional power
 *   maintained beyond the first (applied at chart time, not the roll).
 * - Table 6-2 (book p160): 75+ on the phenomena roll reroutes to Perils of
 *   the Warp (Table 6-3, book p161).
 */

/** Psychic strength levels (Table 6-1). */
export type StrengthLevel = "fettered" | "unfettered" | "push";

export const STRENGTH_LEVELS: readonly StrengthLevel[] = [
	"fettered",
	"unfettered",
	"push",
] as const;

/** Push cap: +3 for sanctioned psykers, +4 for renegades/sorcerers (p157). */
export function pushCap(sanctioned: boolean): number {
	return sanctioned ? 3 : 4;
}

export interface EffectivePsyRatingInput {
	psyRating: number;
	strength: StrengthLevel;
	/** Push levels chosen (only meaningful at push strength). */
	pushLevels?: number;
	/** Number of powers currently sustained (-1 effective PR each, p157). */
	sustainedCount?: number;
}

/**
 * Effective Psy Rating for a technique activation. Sustained powers lower
 * the rating for ALL strengths (p157: "-1 Psy Rating per sustained power",
 * and "maintaining two powers reduces the effective Psy Rating of both
 * powers by 2" — the -1-per-sustained wording in Table 6-1 is the operative
 * per-power rule; the two-power example compounds to -2).
 */
export function effectivePsyRating(input: EffectivePsyRatingInput): number {
	const pr = Math.max(0, Math.floor(input.psyRating));
	const sustained = Math.max(0, Math.floor(input.sustainedCount ?? 0));
	const base =
		input.strength === "fettered"
			? Math.ceil(pr / 2)
			: input.strength === "unfettered"
				? pr
				: pr + Math.max(0, Math.floor(input.pushLevels ?? 1));
	return Math.max(0, base - sustained);
}

/** The Focus Power Test characteristic bonus: +5 per effective PR (p157). */
export function psyRatingBonus(effectiveRating: number): number {
	return 5 * Math.max(0, effectiveRating);
}

/** Total modifier to the Psychic Phenomena table roll (p157). */
export function phenomenaRollModifier(input: {
	pushLevels?: number;
	sustainedCount?: number;
}): number {
	const push = Math.max(0, Math.floor(input.pushLevels ?? 0));
	const sustained = Math.max(0, Math.floor(input.sustainedCount ?? 0));
	return 5 * push + 10 * sustained;
}

/**
 * Whether this activation manifests Psychic Phenomena:
 * - Fettered: never (p157).
 * - Unfettered: doubles on the Focus Power Test roll (p157; also on a
 *   failed test — the roll of doubles triggers regardless of outcome).
 * - Push: automatic (p157).
 */
export function shouldRollPhenomena(
	strength: StrengthLevel,
	outcome: { isDouble: boolean },
): boolean {
	if (strength === "fettered") return false;
	if (strength === "push") return true;
	return outcome.isDouble;
}

/** Which phenomena table to consult (Table 6-2 row 75+, book p160). */
export function phenomenaTableName(roll: number): string {
	return roll >= 75 ? "Perils of the Warp" : "Psychic Phenomena";
}

/** 91+ on a Focus Power Test always fails (book p157). */
export function focusPowerAutoFailFloor(): number {
	return 91;
}