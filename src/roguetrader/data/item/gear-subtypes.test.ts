import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Ammunition } = await import("./ammunition");
const { ForceField } = await import("./force-field");
const { WeaponModification } = await import("./weapon-modification");
const { RangedWeapon } = await import("./ranged-weapon");
const { Gear } = await import("./gear");

describe("Ammunition data model", () => {
	const schema = Ammunition.defineSchema() as unknown as Record<
		string,
		StubField
	>;
	// Bead 1sxq: quantity is inherited from Gear; the base initial is 1
	// (an item exists at quantity 1; 0 = spent/depleted), which deliberately
	// changes Ammunition's old un-authored initial of 0.
	test("quantity is inherited from Gear and defaults to 1", () => {
		expect((schema.quantity as StubField).opts.initial).toBe(1);
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

describe("Gear quantity field (bead 1sxq)", () => {
	const schema = Gear.defineSchema() as unknown as Record<
		string,
		StubField
	>;
	test("quantity is integer, min 0, initial 1, required", () => {
		const quantity = schema.quantity as StubField;
		expect(quantity.opts.initial).toBe(1);
		expect(quantity.opts.min).toBe(0);
		expect(quantity.opts.integer).toBe(true);
		expect(quantity.opts.required).toBe(true);
	});
	// min 0 — a depleted value is valid (spent ordnance, deprecation path
	// for the launcher usage epic).
	test("quantity 0 is within the valid range (spent/depleted)", () => {
		expect((schema.quantity as StubField).opts.min).toBe(0);
	});
});

describe("Gear-derived models inherit quantity", () => {
	// Bead 1sxq: every physical item family gets the field from the Gear
	// base with no per-family re-declaration.
	function quantityOf(model: unknown): Record<string, unknown> {
		const ctor = model as { defineSchema: () => Record<string, unknown> };
		const schema = ctor.defineSchema() as unknown as Record<string, StubField>;
		const quantity = schema.quantity as StubField;
		return quantity.opts;
	}

	test("RangedWeapon inherits quantity (initial 1, min 0)", () => {
		const opts = quantityOf(RangedWeapon);
		expect(opts.initial).toBe(1);
		expect(opts.min).toBe(0);
	});

	test("ForceField inherits quantity (initial 1, min 0)", () => {
		const opts = quantityOf(ForceField);
		expect(opts.initial).toBe(1);
		expect(opts.min).toBe(0);
	});

	test("WeaponModification inherits quantity (initial 1, min 0)", () => {
		const opts = quantityOf(WeaponModification);
		expect(opts.initial).toBe(1);
		expect(opts.min).toBe(0);
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
