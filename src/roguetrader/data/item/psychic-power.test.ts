import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { PsychicPower } = await import("./psychic-power");

import { DamageType } from "./damage-types";

describe("PsychicPower data model", () => {
	const schema = PsychicPower.defineSchema() as unknown as Record<
		string,
		StubField
	>;

	test("powerClass choices are bound/unbound, initial bound", () => {
		const powerClass = schema.powerClass as StubField;
		expect(powerClass.opts.choices).toEqual(["bound", "unbound"]);
		expect(powerClass.opts.initial).toBe("bound");
	});

	test("subtype choices are focus/bolt/barrage/storm/zone, initial focus", () => {
		const subtype = schema.subtype as StubField;
		expect(subtype.opts.choices).toEqual([
			"focus",
			"bolt",
			"barrage",
			"storm",
			"zone",
		]);
		expect(subtype.opts.initial).toBe("focus");
	});

	test("damageType choices come from DamageType, initial Energy", () => {
		const damageType = schema.damageType as StubField;
		expect(damageType.opts.choices).toEqual(Object.values(DamageType));
		expect(damageType.opts.initial).toBe(DamageType.Energy);
	});

	test("numeric and boolean initials", () => {
		expect((schema.rating as StubField).opts.initial).toBe(0);
		expect((schema.sustained as StubField).opts.initial).toBe(false);
	});

	test("free-text fields default to empty string", () => {
		for (const key of ["prerequisite", "range", "damage", "shortDescription"]) {
			expect((schema[key] as StubField).opts.initial).toBe("");
		}
	});

	test("discipline field: registry-keyed choices, blank initial (hkc5)", () => {
		const discipline = schema.discipline as StubField;
		// Core Rulebook p159 seed: the three Astropath disciplines; splats
		// (Navis Primer Voidfrost/Soul Ward/Theosophamy) register at init.
		expect(discipline.opts.choices).toHaveProperty("telepathy");
		expect(discipline.opts.choices).toHaveProperty("telekinesis");
		expect(discipline.opts.choices).toHaveProperty("divination");
		// Blank = legacy/un-grouped entry (the existing pack predates the
		// field); hkc5 fills the values + registers the NP disciplines.
		expect(discipline.opts.initial).toBe("");
	});
});
