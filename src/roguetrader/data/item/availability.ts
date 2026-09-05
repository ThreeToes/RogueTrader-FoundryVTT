export enum Availability {
	Ubiquitous = "ubiquitous",
	Abundant = "abundant",
	Plentiful = "plentiful",
	Common = "common",
	Average = "average",
	Scarce = "scarce",
	Rare = "rare",
	VeryRate = "very-rare",
	ExtremelyRate = "extremely-rare",
	NearUnique = "near-unique",
	Unique = "unique",
}

/**
 * Case/whitespace-insensitive availability normalizer used as the Gear/
 * Weapon/Armour field `clean`: legacy or hand-edited world data may carry
 * "Common" (capitalized) or "—" placeholders, which fail StringField
 * choices validation at document init and brick the world load. Unknown
 * values fall back to Common WITH a console warning (never silent).
 */
const KNOWN = new Set<string>(Object.values(Availability));

export function normalizeAvailability(value: unknown): string {
	const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
	if (KNOWN.has(raw)) return raw;
	if (raw !== "" && raw !== "—" && raw !== "-") {
		console.warn(
			`rogue-trader: unknown availability "${String(value)}" — falling back to "common".`,
		);
	}
	return Availability.Common;
}
