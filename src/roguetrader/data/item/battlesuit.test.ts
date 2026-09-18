import { describe, expect, test } from "bun:test";
import {
	StubField,
	StubTypedObjectField,
} from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Armour } = await import("./armour");
const { Battlesuit } = await import("./battlesuit");

/**
 * Tau battlesuit schema (bead rojm). The book's profile block on printed p38
 * defines these fields, and p31 makes a battlesuit "a suit of worn armour in
 * all ways" — so the inheritance is asserted too, not just the new fields.
 */
describe("Battlesuit schema (bead rojm)", () => {
	const schema = Battlesuit.defineSchema() as unknown as Record<string, unknown>;

	test("is worn armour: inherits the Armour fields", () => {
		expect(Object.getPrototypeOf(Battlesuit)).toBe(Armour);
		expect(schema.armourPoints).toBeInstanceOf(StubTypedObjectField);
		expect(schema.protectionType).toBeInstanceOf(StubField);
		expect((schema.maxAgility as StubField).opts.nullable).toBe(true);
		// and Gear/Label fields below Armour (availability drives Acquisition).
		expect(schema.availability).toBeInstanceOf(StubField);
	});

	test("hardPoints is a non-negative integer (Support/Weapon System budget)", () => {
		const field = schema.hardPoints as StubField;
		expect(field.opts.integer).toBe(true);
		expect(field.opts.min).toBe(0);
		expect(field.opts.initial).toBe(0);
	});

	test("size and specialRules are plain strings", () => {
		expect(schema.size).toBeInstanceOf(StubField);
		expect(schema.specialRules).toBeInstanceOf(StubField);
	});

	test("strength is the battlesuit's own characteristic (0-100)", () => {
		const field = schema.strength as StubField;
		expect(field.opts.min).toBe(0);
		expect(field.opts.max).toBe(100);
		expect(field.opts.integer).toBe(true);
	});

	test("primarySystems and recommendedLoadout default to empty lists", () => {
		for (const key of ["primarySystems", "recommendedLoadout"]) {
			expect(schema[key]).toBeInstanceOf(StubField);
			const field = schema[key] as StubField;
			expect(field.element ?? field.of).toBeInstanceOf(StubField);
		}
	});
});
