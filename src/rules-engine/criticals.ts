/**
 * Character Critical Damage — pure maths for the RT core Critical Damage
 * chapter plus the Tau battlesuit override (Tau Character Guide p31).
 *
 * Nothing here touches Foundry: it decides WHICH table to roll, at WHAT
 * severity, whether a worn battlesuit diverts the wound, and how many effects a
 * repair removes. The Foundry side (rolling, storing on the actor, posting the
 * card) lives in src/roguetrader/rules/criticals.ts, exactly as the ship
 * criticals split between this package and the adapter.
 */

/** The book's critical-table regions; our six locations collapse onto these. */
export const CRITICAL_REGIONS = ["Head", "Body", "Arm", "Leg"] as const;
export type CriticalRegion = (typeof CRITICAL_REGIONS)[number];

/** The four RT core damage types that have critical tables. */
export const CRITICAL_DAMAGE_TYPES = [
	"Energy",
	"Impact",
	"Rending",
	"Explosive",
] as const;

/**
 * Severity caps at 10: the tables print ten results, and a character cannot
 * accumulate more than ten Critical Damage in one location (core book).
 */
export const MAX_CRITICAL_SEVERITY = 10;

/**
 * Which critical region a hit location belongs to. The book shares one table
 * across both limbs ("Critical Hit (Energy, Arm)" is used for either arm), which
 * is why left- and right- variants fold together here.
 */
export function criticalRegion(location: string | null | undefined): CriticalRegion {
	const key = (location ?? "").toLowerCase();
	if (key.includes("head")) return "Head";
	if (key.includes("arm")) return "Arm";
	if (key.includes("leg")) return "Leg";
	return "Body";
}

/**
 * Name of the core critical table for a damage type + location, matching the
 * `criticals` pack's table names ("Critical Hit (Energy, Head)").
 */
export function criticalTableName(
	damageType: string,
	location: string,
): string {
	return `Critical Hit (${damageType}, ${criticalRegion(location)})`;
}

/**
 * Severity of a critical hit: the TOTAL Critical Damage in that location after
 * this hit, capped at ten (core book: the table is entered with accumulated
 * critical damage, not with the excess of this one blow).
 */
export function criticalSeverity(
	existingCritical: number,
	excessDamage: number,
	max = MAX_CRITICAL_SEVERITY,
): number {
	const total = Math.max(0, existingCritical) + Math.max(0, excessDamage);
	return Math.min(max, Math.max(1, total));
}

/**
 * Split incoming damage into the part wounds can absorb and the part that
 * becomes Critical Damage. Once a character is on 0 wounds every point of
 * further damage is critical — that is the flow the apply-damage button did
 * not have (it floored at 0 and threw the rest away).
 */
export function splitWoundDamage(
	currentWounds: number,
	incomingDamage: number,
): { applied: number; excess: number } {
	const wounds = Math.max(0, currentWounds);
	const damage = Math.max(0, incomingDamage);
	const applied = Math.min(damage, wounds);
	return { applied, excess: damage - applied };
}

/**
 * Tau battlesuit override (Tau Character Guide p31): the first time a wearer
 * would suffer Critical Damage each Turn, roll 1d10 —
 *   "on a result of 9 or higher, he suffers Critical Damage as normal.
 *    Otherwise, he does not suffer that Critical Damage; instead, roll on
 *    Table 1–5: Battlesuit Critical Effects and apply the result."
 *
 * Returns true when the Critical Damage stands (9+), false when the battlesuit
 * absorbs it and the caller must roll the battlesuit table instead.
 */
export function battlesuitSuffersCritical(d10: number): boolean {
	return d10 >= 9;
}

/** Name of the battlesuit critical table (Tau Character Guide Table 1-5). */
export const BATTLESUIT_CRITICAL_TABLE = "Battlesuit Critical Effects (Tau)";

/**
 * Tau battlesuit repair (p31): "he removes one Battlesuit Critical Effect of
 * his choice, plus one additional Battlesuit Critical Effect per Degree of
 * Success he scored on the Test." A failed test removes nothing.
 */
export function repairEffectCount(degreesOfSuccess: number): number {
	if (degreesOfSuccess < 0) return 0;
	return 1 + degreesOfSuccess;
}

/** A rollable table row, in the shape the packs author them. */
export interface CriticalResultRow {
	range?: [number, number] | null;
	text?: string;
}

/**
 * Pick the table row a d100 roll lands on. The core critical tables are
 * severity-ordered d10s with cumulative ranges, but the battlesuit table
 * (Tau Guide p31) has explicit bands, so selection must honour the row's own
 * range instead of assuming one row per die face.
 *
 * Returns null when the roll falls in no row — a gap in the pack data, which
 * the caller reports rather than silently picking something.
 */
export function selectCriticalResult(
	roll: number,
	rows: ReadonlyArray<CriticalResultRow>,
): CriticalResultRow | null {
	for (const row of rows) {
		if (!row.range) continue;
		const [min, max] = row.range;
		if (roll >= min && roll <= max) return row;
	}
	return null;
}
