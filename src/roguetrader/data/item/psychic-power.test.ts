import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { PsychicPower } = await import("./psychic-power");

import { DamageType } from "./damage-types";
import { registerPowerSubtype } from "../../rules/power-resolution";

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

	test("subtype choices are the registry seed, initial focus", () => {
		const subtype = schema.subtype as StubField;
		// Core Rulebook Ch. VI seed, in registration order (bead ilpz). The
		// registry is the ONE vocabulary source; extension tests below append
		// subtypes, so pin the seed as the first five names. The FUNCTION form
		// is evaluated as Foundry does at validation time — a live read, not a
		// snapshot.
		expect(typeof subtype.opts.choices).toBe("function");
		expect(
			(subtype.opts.choices as () => string[])().slice(0, 5),
		).toEqual([
			"focus",
			"bolt",
			"barrage",
			"storm",
			"zone",
		]);
		expect(subtype.opts.initial).toBe("focus");
	});

	test("one registration extends both the schema choices and resolution (ilpz)", () => {
		registerPowerSubtype("miasma", { damage: false, sustained: true });
		// The SAME field the schema materialised at describe scope — the real
		// Foundry seam: the field evaluates its choices function at validation
		// time, so registrations made after the schema was built are included
		// with no second edit and no fresh defineSchema() call.
		const subtype = schema.subtype as StubField;
		expect((subtype.opts.choices as () => string[])()).toContain("miasma");
	});

	// The dkh9-class pin (bead ilpz review): the schema above was built
	// BEFORE this test runs. With the OLD eager `psychicPowerSubtypes.choices`
	// property access, a subtype registered after first materialisation was
	// frozen OUT of the field's choices — the sheet dropdown (which reads the
	// registry per render) offered it but a save was REJECTED at validation.
	// As a function, the evaluated choices at "validation time" accept it.
	// NOTE: Registry has no removal seam — the throwaway subtype stays
	// registered after this test (like "miasma" above); every other pin here
	// is order-neutral (the seed order test slices the first five names).
	test("a subtype registered AFTER schema materialisation is accepted (dkh9 class, ilpz)", () => {
		const subtype = schema.subtype as StubField;
		const choicesNow = (): string[] =>
			(subtype.opts.choices as unknown as () => string[])();
		registerPowerSubtype("late-power-subtype", {
			damage: false,
			sustained: false,
		});
		// The schema was built by the describe-scope IIFE above; the choices
		// function must still surface (and thus accept) the late subtype.
		expect(choicesNow()).toContain("late-power-subtype");
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
		// `choices` flips StringField's `blank` default to false — without this
		// the empty discipline value fails validation and the power fails to
		// load (regression class found 2026-09-14).
		expect(discipline.opts.blank).toBe(true);
	});
});
