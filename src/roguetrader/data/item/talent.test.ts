import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

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
		const schema = Talent.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const effects = schema.effects as unknown as { of: unknown };
		const slot = effects.of as {
			fields: Record<string, StubField>;
		};
		expect(slot.fields.testKey).toBeDefined();
		expect(slot.fields.value.opts.initial).toBe(0);
	});

	// Bead 707 decision: talents carry BOTH the terse table benefit
	// (shortDescription) and the full rulebook prose (description).
	test("has shortDescription and long description fields", () => {
		const schema = Talent.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		expect(schema.shortDescription).toBeDefined();
		expect(schema.description).toBeDefined();
		expect(schema.shortDescription.opts.initial).toBe("");
		expect(schema.description.opts.initial).toBe("");
	});

	test("registry has seeded talents", () => {
		expect(talents.keys().length).toBeGreaterThan(5);
	});

	describe("canGrant", () => {
		const T = Talent;
		test("no prereq always grants", () => {
			expect(T.canGrant(undefined, new Set())).toBe(true);
			expect(T.canGrant("", new Set())).toBe(true);
		});

		test("prereq met only when owned", () => {
			expect(T.canGrant("frenzy", new Set(["frenzy"]))).toBe(true);
			expect(T.canGrant("frenzy", new Set(["hip-shooting"]))).toBe(false);
		});
	});

	test("effectsForKind filters by kind", () => {
		const t = Object.create(Talent.prototype) as InstanceType<typeof Talent>;
		t.effects = [
			{ kind: "test-modifier", testKey: "bs", value: 10, label: "BS only" },
			{ kind: "wounds-max", testKey: "", value: 1, label: "Wounds" },
		];
		expect(t.effectsForKind("test-modifier")).toHaveLength(1);
		expect(t.effectsForKind("wounds-max")).toHaveLength(1);
	});
});
