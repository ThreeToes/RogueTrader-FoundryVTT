import { describe, expect, test } from "bun:test";
import { StubField } from "../../../../tests/helpers/foundry-schema-stub";

await import("../../../../tests/helpers/foundry-schema-stub");

const { Talent } = await import("./talent");
import { talentCategories, talents } from "../../registry";

describe("Talent data model", () => {
	test("category choices come from the talentCategories registry", () => {
		const schema = Talent.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const category = schema.category as StubField;
		expect(category.opts.choices).toEqual(talentCategories.choices);
		expect(category.opts.initial).toBe("background");
		expect(Object.values(talentCategories.choices)[0]).toMatch(
			/^TALENT_CATEGORY\./,
		);
	});

	test("effects are array-of-schema with the expected fields", () => {
		const schema = Talent.defineSchema() as unknown as Record<string, StubField>;
		const effects = schema.effects as unknown as { of: unknown };
		const slot = effects.of as {
			fields: Record<string, StubField>;
		};
		expect(slot.fields.testKey).toBeDefined();
		expect(slot.fields.value.opts.initial).toBe(0);
	});

	test("registry has seeded talents", () => {
		expect(talents.keys().length).toBeGreaterThan(5);
	});

	test("effectsWithTestKey matches empty testKey as wildcard", () => {
		const t = Object.create(Talent.prototype) as Talent & {
			effects: Array<{ testKey: string; value: number; label: string }>;
		};
		t.effects = [
			{ testKey: "", value: 5, label: "All tests" },
			{ testKey: "bs", value: 10, label: "BS only" },
		];
		expect(t.effectsWithTestKey("ws")).toHaveLength(1);
		expect(t.effectsWithTestKey("bs")).toHaveLength(2);
	});
});