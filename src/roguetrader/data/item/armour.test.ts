import { describe, expect, test } from "bun:test";
import {
	StubField,
	StubTypedObjectField,
} from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Armour } = await import("./armour");

describe("Armour schema (bead a07)", () => {
	const schema = Armour.defineSchema() as unknown as Record<string, unknown>;

	test("maxAgility is a nullable number field (null = no limit)", () => {
		const field = schema.maxAgility as StubField;
		expect(field.opts.nullable).toBe(true);
		expect(field.opts.integer).toBe(true);
		expect(field.opts.min).toBe(0);
	});

	test("armourPoints is a per-location number map (min 0 = uncovered)", () => {
		const field = schema.armourPoints as StubTypedObjectField;
		const points = field.of as StubField;
		expect(field).toBeInstanceOf(StubTypedObjectField);
		expect(points.opts.min).toBe(0);
	});

	test("protectionType is a string field", () => {
		expect(schema.protectionType).toBeInstanceOf(StubField);
	});
});