/**
 * Ship combat kernel (bead cj6k, Core Rulebook Ch. VIII pp218-223).
 * Pure, Foundry-free, data-in/data-out — the adapter rolls dice and applies
 * state; these functions only derive.
 *
 * Rules grounded in the Core Rulebook (verified against the book layout
 * dump, src/packs/.extraction-src/CACHED-core-rulebook-layout.txt pp219-223):
 * - Macrobattery: successful BS test scores 1 hit + 1 per degree of success,
 *   max the weapon's Strength (p220). Roll damage once per hit, total
 *   combined.
 * - Lance: 1 hit + 1 per three degrees of success; each hit resolved
 *   separately; IGNORES armour (damage goes straight to Hull Integrity).
 * - Range: > range (up to 2x) = -10 BS; <= half range = +10 BS (p220).
 * - Void shields: cancel incoming hits equal to shield strength, then
 *   overload; restored before the next attacker's fire (p220-221).
 * - Damage: total minus Armour; remainder is Hull Integrity loss (p221).
 * - Each point of Hull Integrity lost also costs 1 Crew Population and
 *   1 Morale (p221).
 * - Critical Hit: degrees >= the weapon's Crit Rating (example p221: 4
 *   degrees met Crit Rating 4); roll 1d5 on Table 8-12 and apply; a critical
 *   that deals no Hull damage still does 1 automatic damage (p220).
 * - Crippled (0 Hull Integrity): -10 Manoeuvrability and Detection, Speed
 *   halved, weapon Strength halved (round up) (p221). Further damage past
 *   armour inflicts a Critical Hit using the exceeded damage as the chart
 *   value (p221).
 */

/** Weapon kinds per Table 8-4 (book p202). */
export type ShipWeaponKind = "macrobattery" | "lance";

/**
 * BS modifier for firing at a given distance (book p220): within half range
 * +10, beyond range (up to 2x) -10, otherwise 0.
 */
export function rangeModifier(
	range: number,
	distance: number,
): { modifier: number; reason: "half" | "long" | "normal" } {
	if (distance <= range / 2) return { modifier: 10, reason: "half" };
	if (distance > range) return { modifier: -10, reason: "long" };
	return { modifier: 0, reason: "normal" };
}

/**
 * Hits scored by a successful BS test (book p220): macrobatteries 1 + 1 per
 * degree of success, lances 1 + 1 per three degrees; both capped by the
 * weapon's Strength.
 */
export function hitsScored(
	kind: ShipWeaponKind,
	degrees: number,
	strength: number,
): number {
	const raw =
		kind === "lance" ? 1 + Math.floor(degrees / 3) : 1 + degrees;
	return Math.min(Math.max(0, strength), Math.max(1, raw));
}

/**
 * Void shields absorb hits up to their remaining strength (book p220-221):
 * any hits beyond the shield strength strike the hull. A shield overloads
 * only once it has absorbed its full strength in hits; it restores before
 * the NEXT attacker's fire, so `shields` here is only depleted WITHIN this
 * salvo's resolution.
 */
export function applyVoidShields(
	hits: number,
	shields: number,
): { absorbed: number; through: number; overloaded: boolean } {
	const shieldStrength = Math.max(0, shields);
	const absorbed = Math.min(Math.max(0, hits), shieldStrength);
	return {
		absorbed,
		through: Math.max(0, hits) - absorbed,
		overloaded: shieldStrength > 0 && absorbed >= shieldStrength,
	};
}

export interface SalvoRequest {
	/** Combined damage of the hits that got through the shields. */
	damageTotal: number;
	/** Target's Armour. Ignored entirely for lance hits (book p220). */
	armour: number;
	/** Lance hits bypass armour and go straight to Hull Integrity. */
	lance: boolean;
}

export interface SalvoOutcome {
	hullDamage: number;
	armourAbsorbed: number;
}

/**
 * Damage vs Armour (book p221): Armour subtracts from the damage total; the
 * remainder is Hull Integrity loss. Lance hits ignore armour entirely.
 */
export function resolveSalvoDamage(req: SalvoRequest): SalvoOutcome {
	if (req.lance) {
		return { hullDamage: Math.max(0, req.damageTotal), armourAbsorbed: 0 };
	}
	const armourAbsorbed = Math.min(
		Math.max(0, req.damageTotal),
		Math.max(0, req.armour),
	);
	return {
		hullDamage: Math.max(0, req.damageTotal) - armourAbsorbed,
		armourAbsorbed,
	};
}

/**
 * Hull Integrity losses drag Crew Population and Morale down 1:1
 * (book p221).
 */
export function crewLossFromHullDamage(
	hullDamage: number,
): { population: number; morale: number } {
	const loss = Math.max(0, hullDamage);
	return { population: loss, morale: loss };
}

/**
 * A shot criticals when its degrees of success meet the weapon's Crit
 * Rating (book p220-221; the p221 example uses 4 degrees vs Crit Rating 4).
 */
export function isCritical(degrees: number, critRating: number): boolean {
	return critRating > 0 && degrees >= critRating;
}

/** Crippled state modifiers (book p221): at 0 Hull Integrity. */
export function crippledEffects(hullIntegrity: number): {
	crippled: boolean;
	manoeuvrabilityPenalty: number;
	detectionPenalty: number;
	speedHalved: boolean;
	weaponStrengthHalved: boolean;
} {
	const crippled = hullIntegrity <= 0;
	return {
		crippled,
		manoeuvrabilityPenalty: crippled ? -10 : 0,
		detectionPenalty: crippled ? -10 : 0,
		speedHalved: crippled,
		weaponStrengthHalved: crippled,
	};
}

/**
 * Table 8-12: Critical Hits (book p222). The adapter rolls 1d5 for a
 * weapon Crit Rating hit; the chart value selects the entry. The attacker
 * picks affected Components among ones he "knows of" — selection is an
 * adapter concern, this table is data.
 */
export interface ShipCriticalEntry {
	/** Inclusive lower bound of the chart roll. */
	min: number;
	/** Inclusive upper bound of the chart roll. */
	max: number;
	/** Machine key for i18n / journal lookups. */
	key: string;
	/** Verbatim chart name. */
	name: string;
}

export const SHIP_CRITICALS: ShipCriticalEntry[] = [
	{ min: 1, max: 1, key: "holed", name: "Holed" },
	{ min: 2, max: 2, key: "internal-damage", name: "Internal Damage" },
	{ min: 3, max: 3, key: "sensors-damaged", name: "Sensors damaged" },
	{ min: 4, max: 4, key: "thrusters-damaged", name: "Thrusters damaged" },
	{ min: 5, max: 5, key: "fire", name: "Fire!" },
	{ min: 6, max: 6, key: "engines-crippled", name: "Engines Crippled" },
	{ min: 7, max: 7, key: "surly-techsprites", name: "Surly Techsprites" },
	{ min: 8, max: 8, key: "decapitation", name: "Decapitation" },
	{ min: 9, max: 10, key: "hull-breach", name: "Hull Breach" },
	{ min: 11, max: 11, key: "catastrophic-damage", name: "Catastrophic Damage" },
	{
		min: 12,
		max: 12,
		key: "catastrophic-overload",
		name: "Catastrophic Overload",
	},
];

/** Resolve a Table 8-12 roll (book p222) to its chart entry. */
export function shipCritical(roll: number): ShipCriticalEntry | null {
	const value = Math.max(1, Math.min(12, Math.floor(roll)));
	return SHIP_CRITICALS.find((c) => value >= c.min && value <= c.max) ?? null;
}

/**
 * When a CRIPPLED ship takes damage past its armour, the exceeded damage
 * value is read directly as the Critical Hit chart result (book p221).
 */
export function criticalFromCrippledDamage(
	damagePastArmour: number,
): ShipCriticalEntry | null {
	return shipCritical(damagePastArmour);
}