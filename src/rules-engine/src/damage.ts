/**
 * Rogue Trader damage resolution, data-in/data-out.
 *
 * One call = one hit at one location/facing. The kernel NEVER mutates HP or
 * posts chat: it returns a fully-itemised breakdown that adapters render and
 * use for apply-damage decisions.
 *
 * Order of operations (VERIFY against core book, see profile flags):
 *   1. armour reduced by penetration (never below 0)
 *   2. soak = effective armour + toughness bonus
 *   3. primitive-armour rule (profile): non-primitive weapons vs primitive
 *      armour double the POST-SOAK damage
 *   4. Righteous Fury is flagged, not resolved: the adapter rolls any extra
 *      damage and re-enters resolveDamage (or applies it directly) per the
 *      profile's trigger description.
 */
import type { RuleProfile } from "./profile";

/**
 * Strip a trailing Rogue Trader damage-type token from a weapon damage
 * string (e.g. "1d10+4 E" -> formula "1d10+4", type "Energy") so the residue
 * is safe for Foundry's Roll parser, which throws on the letter suffix.
 *
 * The RT core book uses damage types E(nergy), I(mpact), R(end), X(plosive);
 * legacy sources also use S for slash/rending. A trailing whitespace-
 * separated single letter is treated as the type suffix and normalised to
 * the system's canonical DamageType value; anything else is left untouched.
 */
export function parseDamageFormula(damage: string): {
	formula: string;
	type: "Energy" | "Impact" | "Rending" | "Explosive" | null;
} {
	const trimmed = damage.trim();
	const match = /^(?<formula>.*?)(?:\s+(?<type>[EIRSX]))$/i.exec(trimmed);
	if (!match?.groups?.formula) return { formula: trimmed, type: null };
	const formula = match.groups.formula.trim();
	if (!formula) return { formula: trimmed, type: null };
	const letter = match.groups.type.toUpperCase();
	const type =
		letter === "E"
			? "Energy"
			: letter === "I"
				? "Impact"
				: letter === "R" || letter === "S"
					? "Rending"
					: "Explosive";
	return { formula, type };
}

export interface DamageRequest {
	/** Total rolled damage for this hit. */
	roll: number;
	/** Weapon penetration; reduces armour only. */
	penetration?: number;
	/** Whether the weapon is primitive (affects the primitive armour rule). */
	weaponPrimitive?: boolean;
	toughnessBonus: number;
	/** The struck location/facing label (display data only). */
	location: string;
	/** Armour points at the struck location (0 when uncovered). */
	armourValue?: number;
	/** Whether the armour is_primitive (affects the primitive armour rule). */
	armourPrimitive?: boolean;
	/**
	 * Whether the raw damage dice showed the profile's Righteous Fury trigger
	 * (e.g. a natural 10 on a damage die). The kernel cannot inspect the
	 * Foundry roll itself, so the adapter reports the trigger here; without
	 * this the fury never fires.
	 */
	righteousFuryTriggered?: boolean;
	profile: RuleProfile;
}

export interface DamageOutcome {
	location: string;
	rawRoll: number;
	/** Penetration actually applied (bounded by armour). */
	penApplied: number;
	armour: number;
	effectiveArmour: number;
	soak: number;
	/** Damage stopped by soak. */
	absorbed: number;
	/** Damage that got through = wounds reduction (data; caller mutates HP). */
	wounds: number;
	/** True when the primitive-armour doubling rule was applied (VERIFY). */
	primitiveDouble: boolean;
	/** True when Righteous Fury triggered (adapter resolves the extra die). */
	righteousFury: boolean;
}

export function resolveDamage(request: DamageRequest): DamageOutcome {
	const { roll, location, profile } = request;
	const penetration = Math.max(0, request.penetration ?? 0);
	const armourValue = Math.max(0, request.armourValue ?? 0);
	const toughnessBonus = Math.max(0, request.toughnessBonus);

	const penApplied = Math.min(penetration, armourValue);
	const effectiveArmour = armourValue - penApplied;
	const soak = toughnessBonus + effectiveArmour;
	const absorbed = Math.min(roll, soak);
	let wounds = Math.max(0, roll - soak);

	// Primitive armour rule (profile data; VERIFY book wording): non-primitive
	// weapons double WOUNDS against primitive armour.
	const primitiveDouble =
		(profile.primitiveArmourDouble ?? false) &&
		request.weaponPrimitive === false &&
		request.armourPrimitive === true;
	if (primitiveDouble) {
		wounds *= 2;
	}

	// Righteous Fury: kernel only flags triggering hits; the extra damage roll
	// belongs to the adapter (Foundry dice, user-visible). Requires BOTH a
	// damaging hit AND the raw-dice trigger reported by the adapter (bead fix:
	// previously every damaging hit was flagged).
	const righteousFury =
		(profile.righteousFury?.enabled ?? false) &&
		request.righteousFuryTriggered === true &&
		wounds > 0;

	return {
		location,
		rawRoll: roll,
		penApplied,
		armour: armourValue,
		effectiveArmour,
		soak,
		absorbed,
		wounds,
		primitiveDouble,
		righteousFury,
	};
}
