import { describe, expect, test } from "bun:test";
import {
	StubArrayField,
	StubField,
} from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Trait } = await import("./trait");
const { effectsAreLive } = await import("./effects");

describe("Trait schema (bead 25ii)", () => {
	const schema = Trait.defineSchema() as unknown as Record<string, unknown>;

	test("benefit is a plain string field (statblock phrasing)", () => {
		const field = schema.benefit as StubField;
		expect(field).toBeInstanceOf(StubField);
		expect(field.opts.initial).toBe("");
	});

	test("carries the shared effects machinery (yb6 shape)", () => {
		const field = schema.effects as StubArrayField;
		expect(field).toBeInstanceOf(StubArrayField);
		// row shape + default-kind coverage lives in effects.test.ts
		expect(field.of).toBeDefined();
	});

	test("two-flavours text: shortDescription + long HTML description", () => {
		expect(schema.shortDescription).toBeInstanceOf(StubField);
		expect(schema.description).toBeInstanceOf(StubField);
	});
});

describe("traits are always live (bead 25ii — innate, no equip state)", () => {
	test("effectsAreLive returns true for traits regardless of equip state", () => {
		expect(effectsAreLive("trait", undefined)).toBe(true);
		expect(effectsAreLive("trait", "carried")).toBe(true);
		expect(effectsAreLive("trait", "stowed")).toBe(true);
	});
});