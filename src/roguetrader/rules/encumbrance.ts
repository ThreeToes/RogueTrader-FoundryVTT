/**
 * Encumbrance rules (pure, data-in/data-out).
 *
 * v1 scope: carried weight is aggregated by the caller (sum of owned item
 * weights); capacity comes from the actor's manual maxCarriage field.
 * Thresholds are centralised here as the single place to tune (values are
 * remembered RT core rules, VERIFY against the book - the SB-based capacity
 * derivation deliberately stays OUT until the equip-state/container schema
 * work lands, see bead 94p).
 */

export interface EncumbranceOutcome {
	/** Carried weight in kg (caller-aggregated, echoed for display). */
	weight: number;
	/** Capacity in kg (0 = no capacity set). */
	capacity: number;
	/** weight / capacity, clamped 0..1 (0 when capacity unset). */
	ratio: number;
	/**
	 * 0..100 progress percentage for bars; can exceed 100 when over capacity.
	 */
	percent: number;
	/** ok < ENCUMBERED_AT, encumbered from ENCUMBERED_AT, over past 100%. */
	state: "ok" | "encumbered" | "over";
}

export const ENCUMBERED_AT = 0.8; // fraction of capacity (VERIFY)

/**
 * Default kilograms of capacity per Strength Bonus (best-effort RT core rule,
 * VERIFY against the book). Used only when the manual maxCarriage field is 0.
 */
export const CAPACITY_PER_STRENGTH_BONUS = 3; // VERIFY

/** Derived capacity from Strength Bonus when no manual value is set. */
export function deriveCapacity(strengthBonus: number): number {
	return Math.max(0, strengthBonus) * CAPACITY_PER_STRENGTH_BONUS;
}

export function resolveEncumbrance(
	weightKg: number,
	capacityKg: number,
): EncumbranceOutcome {
	const weight = Math.max(0, weightKg);
	const capacity = Math.max(0, capacityKg);
	const ratio = capacity > 0 ? weight / capacity : 0;
	const percent = Math.round(ratio * 100);
	let state: EncumbranceOutcome["state"] = "ok";
	if (capacity > 0 && ratio > 1) state = "over";
	else if (capacity > 0 && ratio >= ENCUMBERED_AT) state = "encumbered";
	return { weight, capacity, ratio, percent, state };
}