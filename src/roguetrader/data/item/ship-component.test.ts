import { describe, expect, test } from "bun:test";

// The stub must be installed BEFORE the data models load (they extend
// foundry.abstract at import time); never rely on cross-file ordering
// (bead-free convention, see tests-are-colocated note in AGENT-GUIDE).
import "../../../test-helpers/foundry-schema-stub";
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
				"componentType",
				"description",
				"hullTypes",
				"power",
				"space",
				"sp",
				"special",
				"unique",
				// Component condition (bead xfta, book p223).
				"state",
				"depressurised",
				// Book + printed page (bead r8rx audit): the packs set this on every
				// component and the schema used to discard it.
				"source",
				// Printed Strength column (bead r8rx audit): shared with landing
				// bays, which have a Strength but no Damage/Crit Rating.
				"strength",
			].sort(),
		);
	});

	test("ShipWeaponComponent adds the Table 8-4 combat columns", () => {
		const schema = ShipWeaponComponent.defineSchema();
		for (const key of [
			"strength",
			"strengthRoll",
			"damage",
			"critRating",
			"range",
		]) {
			expect(schema[key]).toBeDefined();
		}
	});

	test("range is a min/max number-pair SchemaField (bead 3atc, epic c48r)", () => {
		const schema = ShipWeaponComponent.defineSchema() as Record<
			string,
			{ fields: Record<string, unknown> }
		>;
		const range = schema.range.fields as Record<
			string,
			{ opts: Record<string, unknown> }
		>;
		// Battlefleet Koronus prints extended-range weapons as VU bands
		// (Nova Cannon "6-40"/"6-36"/"6-35", BFK p34/p42), so the old single
		// NumberField became a min/max pair — integer VU bounds ≥ 0,
		// defaulting to 0/0.
		for (const bound of ["min", "max"]) {
			expect(range[bound]).toBeDefined();
			expect(range[bound].opts).toMatchObject({ min: 0, integer: true, initial: 0 });
		}
	});

	test("legacy single-number range migrates to a symmetric band (bead 3atc)", () => {
		// Old world docs carry a bare number for range; migrateData (called by
		// _initializeSource, before schema validation) turns it into the band.
		const migrated = ShipWeaponComponent.migrateData({
			range: 9,
		}) as { range: { min: number; max: number } };
		expect(migrated.range).toEqual({ min: 9, max: 9 });
		// A pair already in band shape passes through unchanged.
		const kept = ShipWeaponComponent.migrateData({
			range: { min: 6, max: 40 },
		}) as { range: { min: number; max: number } };
		expect(kept.range).toEqual({ min: 6, max: 40 });
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