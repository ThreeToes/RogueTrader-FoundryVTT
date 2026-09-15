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

	test("template.json vehicle block keeps only the load-bearing keys", async () => {
		const template = (await import(
			"../../../../template.json"
		)) as unknown as {
			Actor: { types: string[]; vehicle: Record<string, unknown> };
		};
		// dh2j: without the type entry Foundry cannot create Vehicle actors
		// through the UI and the registered sheet is unreachable dead code.
		expect(template.Actor.types).toContain("vehicle");
		const vehicle = template.Actor.vehicle as Record<string, unknown>;
		// Bead fi3o: the vehicle block used to mirror the whole schema
		// (structuralIntegrity, handling, speed, vehicleClass, traits, systems,
		// crew, mountedWeapons, description). Those are declared by the Vehicle
		// model, which now owns the defaults — assert THAT instead, so the
		// "no silent drops" guarantee lib6 wanted is kept by the schema.
		const { Vehicle } = (await import("./vehicle")) as unknown as {
			Vehicle: { defineSchema(): Record<string, unknown> };
		};
		const schema = Vehicle.defineSchema();
		for (const key of [
			"structuralIntegrity",
			"handling",
			"speed",
			"vehicleClass",
			"traits",
			"systems",
			"crew",
			"mountedWeapons",
			"description",
		]) {
			expect(schema[key], `schema missing ${key}`).toBeDefined();
			expect(vehicle[key], `vehicle.${key} must not be in the template`).toBeUndefined();
		}

		// The two survivors. armour is a genuine non-default pre-population:
		// the model is a TypedObjectField whose Foundry default is an EMPTY map,
		// so without this a fresh vehicle would have no facing keys.
		expect(vehicle.armour).toEqual({
			front: 0,
			left: 0,
			right: 0,
			rear: 0,
			top: 0,
			bottom: 0,
		});
		// prototypeToken is document-level: a TypeDataModel cannot supply it.
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
