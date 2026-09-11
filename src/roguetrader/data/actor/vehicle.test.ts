import { beforeAll, describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Vehicle } = await import("./vehicle");

describe("Vehicle data model", () => {
	test("schema initials are safe defaults", () => {
		const schema = Vehicle.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const si = schema.structuralIntegrity as unknown as {
			fields: Record<string, StubField>;
		};
		expect(si.fields.value.opts.initial).toBe(0);
		expect(si.fields.max.opts.initial).toBe(0);
		expect(schema.handling.opts.initial).toBe(0);
		expect(schema.speed.opts.initial).toBe(0);
		expect(schema.vehicleClass.opts.initial).toBe("ground");
	});

	test("armour field is a TypedObjectField over NumberField(min 0)", () => {
		const schema = Vehicle.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const armour = schema.armour as unknown as {
			of: StubField;
		};
		// structural check (never instanceof - stub classes differ per module copy)
		expect(typeof armour.of).toBe("object");
		const num = armour.of as StubField;
		expect(num.opts.min).toBe(0);
		expect(num.opts.initial).toBe(0);
	});

	test("facings/traits/vehicleClass choices come from the registries", () => {
		const schema = Vehicle.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const vc = schema.vehicleClass as StubField;
		expect(vc.opts.choices).toHaveProperty("ground");
		expect(vc.opts.choices).toHaveProperty("voidcraft");
		expect(Object.values(vc.opts.choices)[0]).toMatch(/^VEHICLE_CLASS\./);
		const traitsField = schema.traits as unknown as { of: StubField };
		const traitInner = traitsField.of as StubField;
		expect(traitInner.opts.choices).toHaveProperty("hovering");
	});

	test("armourAt reads configured facings (via raw instance)", () => {
		const v = Object.create(Vehicle.prototype) as Vehicle & {
			armour: Record<string, number>;
		};
		v.armour = { front: 20, rear: 10 };
		expect(v.armourAt("front")).toBe(20);
		expect(v.armourAt("rear")).toBe(10);
		expect(v.armourAt("top")).toBe(0);
	});

	test("system slots capture rating and damaged state (schema shape)", () => {
		const schema = Vehicle.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const systems = schema.systems as unknown as {
			of: StubSchemaFieldLike;
		};
		const slot = systems.of;
		expect(slot.fields.rating.opts.initial).toBe(0);
		expect(slot.fields.damaged.opts.initial).toBe(false);
	});

	test("template.json vehicle block matches the schema (no silent drops)", async () => {
		const template = (await import(
			"../../../../template.json"
		)) as unknown as {
			Actor: { types: string[]; vehicle: Record<string, unknown> };
		};
		// dh2j: without the type entry Foundry cannot create Vehicle actors
		// through the UI and the registered sheet is unreachable dead code.
		expect(template.Actor.types).toContain("vehicle");
		const vehicle = template.Actor.vehicle as Record<string, unknown>;
		const si = vehicle.structuralIntegrity as Record<string, number>;
		expect(si).toEqual({ value: 0, max: 0 });
		// Armour facings seeded from the vehicleFacings registry, all 0.
		expect(vehicle.armour).toEqual({
			front: 0,
			left: 0,
			right: 0,
			rear: 0,
			top: 0,
			bottom: 0,
		});
		expect(vehicle.handling).toBe(0);
		expect(vehicle.speed).toBe(0);
		// vehicleClass carries the schema's registry initial, not a blank.
		expect(vehicle.vehicleClass).toBe("ground");
		expect(vehicle.traits).toEqual([]);
		expect(vehicle.systems).toEqual({});
		expect(vehicle.crew).toEqual([]);
		expect(vehicle.mountedWeapons).toEqual([]);
		expect(vehicle.description).toBe("");
		const token = vehicle.prototypeToken as Record<string, unknown>;
		const bar1 = token.bar1 as Record<string, string>;
		expect(bar1.attribute).toBe("system.structuralIntegrity");
	});
});

interface StubSchemaFieldLike {
	fields: Record<string, StubField>;
}

beforeAll(async () => {
	// ensure module import order independence
	await import("./vehicle");
});
