export enum DamageType {
	Energy = "Energy",
	Explosive = "Explosive",
	Impact = "Impact",
	Rending = "Rending",
}

/**
 * Normalise a stored/legacy damage-type value to the canonical enum.
 * Accepts full enum values, book letters (E/I/R/X) and the legacy slash
 * shorthand S. Returns null for anything unrecognised (including empty).
 */
export function normaliseDamageType(
	raw: string | null | undefined,
): DamageType | null {
	const value = (raw ?? "").trim().toLowerCase();
	switch (value) {
		case "e":
		case "energy":
			return DamageType.Energy;
		case "x":
		case "explosive":
			return DamageType.Explosive;
		case "i":
		case "impact":
			return DamageType.Impact;
		case "r":
		case "s":
		case "rending":
			return DamageType.Rending;
		default:
			return null;
	}
}
