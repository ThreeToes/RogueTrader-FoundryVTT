import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Skill } = await import("./skill");

/**
 * Bead 4z81: skills carry a stable slug `key` (schema parity with Career) so
 * the packer can stamp `system.key` and the advancement dialog can resolve
 * careers.yaml rank rows ("key: awareness", name: "") to book names.
 */
describe("Skill data model", () => {
	test("schema declares key as a slug string defaulting to ''", () => {
		const schema = Skill.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const key = schema.key as StubField;
		expect(key).toBeDefined();
		expect(key.opts.initial).toBe("");
		expect(key.opts.required).toBe(true);
		expect(key.opts.nullable).toBe(false);
	});
	// Bead dgei (A5): the former "round-trip" assign-and-read-back test was
	// dropped — it could only fail if the field were absent, which the
	// defineSchema test above already covers; derivation is asserted in
	// utils/compendia.test.ts (toSourceDocument) and the guard in
	// advance-key-resolution.test.ts.
});
