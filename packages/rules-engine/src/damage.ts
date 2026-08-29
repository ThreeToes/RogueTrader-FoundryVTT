/**
 * FFG damage resolution, data-in/data-out.
 *
 * Per Rogue Trader core (VERIFY: book wording): total soak = Toughness Bonus +
 * armour AP for the struck location, with penetration reducing armour only.
 * The kernel never mutates HP; systems/engines consume the per-location
 * breakdown.
 */
export interface DamageRequest {
	/** Total rolled damage. */
	roll: number;
	/** Weapon penetration; bounded to not exceed armour. */
	penetration?: number;
	toughnessBonus: number;
	/** Armour points per body location: `{ head: 3, body: 5 }` (absent = 0). */
	armour: Record<string, number>;
}

export interface LocationDamage {
	location: string;
	armour: number;
	effectiveArmour: number;
	soak: number;
	damage: number;
	absorbed: number;
}

export interface DamageOutcome {
	/** Result per supplied location (engine consumers pick locations). */
	locations: LocationDamage[];
}

export function resolveDamage(request: DamageRequest): DamageOutcome {
	const locations = Object.keys(request.armour).map((location) => {
		const armour = request.armour[location] ?? 0;
		const effectiveArmour = Math.max(0, armour - (request.penetration ?? 0));
		const soak = request.toughnessBonus + effectiveArmour;
		const absorbed = Math.min(request.roll, soak);
		return {
			location,
			armour,
			effectiveArmour,
			soak,
			absorbed,
			damage: Math.max(0, request.roll - soak),
		};
	});
	return { locations };
}
