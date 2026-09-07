import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Ammunition } = await import("./ammunition");
const { ForceField } = await import("./force-field");
const { WeaponModification } = await import("./weapon-modification");

describe("Ammunition data model", () => {
	const schema = Ammunition.defineSchema() as unknown as Record<
		string,
		StubField
	>;
	test("quantity defaults to 0 and is required", () => {
		expect((schema.quantity as StubField).opts.initial).toBe(0);
		expect((schema.quantity as StubField).opts.required).toBe(true);
	});
	test("inherits Gear fields (availability, weight)", () => {
		expect(schema.availability).toBeDefined();
		expect(schema.weight).toBeDefined();
	});
});

describe("ForceField data model", () => {
	const schema = ForceField.defineSchema() as unknown as Record<
		string,
		StubField
	>;
	test("protection defaults to 0", () => {
		expect((schema.protection as StubField).opts.initial).toBe(0);
	});
	test("overloadChance is a 0-100 percentage", () => {
		const overload = schema.overloadChance as StubField;
		expect(overload.opts.initial).toBe(0);
		expect(overload.opts.min).toBe(0);
		expect(overload.opts.max).toBe(100);
	});
	test("inherits Gear fields", () => {
		expect(schema.equipState).toBeDefined();
	});
});

describe("WeaponModification data model", () => {
	const schema = WeaponModification.defineSchema() as unknown as Record<
		string,
		StubField
	>;
	test("upgrades text defaults to empty", () => {
		expect((schema.upgrades as StubField).opts.initial).toBe("");
	});
	test("inherits Gear fields", () => {
		expect(schema.craftsmanship).toBeDefined();
	});
});
