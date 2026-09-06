import { describe, expect, test } from "bun:test";
import {
	ShipComponent,
	ShipWeaponComponent,
} from "../../data/item/ship-component";
import { normalizeAvailability } from "../../data/item/availability";

// Bead f5xu: starship component schemas (Core Rulebook Tables 8-3..8-8).
// The pack data is machine-local (src/packs is gitignored); these tests pin
// the schema shape + the Table 8-8 availability vocabulary it must use.

describe("ship component schema (bead f5xu)", () => {
	test("ShipComponent defaults", () => {
		const schema = ShipComponent.defineSchema();
		expect(Object.keys(schema).sort()).toEqual(
			[
				"availability",
				"category",
				"description",
				"hullTypes",
				"power",
				"space",
				"sp",
				"special",
				"unique",
			].sort(),
		);
	});

	test("ShipWeaponComponent adds the Table 8-4 combat columns", () => {
		const schema = ShipWeaponComponent.defineSchema();
		for (const key of ["strength", "damage", "critRating", "range"]) {
			expect(schema[key]).toBeDefined();
		}
	});

	test("Table 8-8 availability tokens are valid vocabulary", () => {
		// scarce (SP "-" / 1 SP), rare (+1 / 2 SP), very-rare (+2 / 3 SP),
		// extremely-rare (archeotech), near-unique (xeno-tech).
		for (const token of [
			"scarce",
			"rare",
			"very-rare",
			"extremely-rare",
			"near-unique",
		]) {
			// normalizeAvailability falls back to "common" (with a warning)
			// for unknown tokens, so a known token must survive the round-trip.
			expect(normalizeAvailability(token)).toBe(token);
		}
	});
});