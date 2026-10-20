import { describe, expect, test } from "bun:test";
import {
	StubField,
	StubHtmlField,
	StubSchemaField,
} from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { ShipAction } = await import("./ship-action");

// Bead oumh (epic necp): the ship-action Item type — Table 8-10/8-11 rows
// (Core Rulebook Ch. VIII), the source the ship-action roll kind consumes.
describe("ship-action schema (bead oumh)", () => {
	const schema = ShipAction.defineSchema() as unknown as Record<
		string,
		StubField
	>;

	test("carries the printed columns: cost, test key + difficulty, prose", () => {
		expect(schema.actionCost).toBeDefined();
		const roll = schema.roll as unknown as StubSchemaField;
		expect(roll.fields.test).toBeDefined();
		expect(roll.fields.difficulty).toBeDefined();
		expect(schema.shortDescription).toBeDefined();
		expect(schema.description).toBeInstanceOf(StubHtmlField);
		expect(schema.source).toBeDefined();
	});

	test("defaults empty (the pack bead owns the values)", () => {
		expect((schema.actionCost as StubField).opts.initial).toBe("");
		expect(((schema.roll as unknown as StubSchemaField).fields
			.test as StubField).opts.initial).toBe("");
		expect(((schema.roll as unknown as StubSchemaField).fields
			.difficulty as StubField).opts.initial).toBe("");
		expect((schema.shortDescription as StubField).opts.initial).toBe("");
		expect(
			(schema.description as unknown as StubHtmlField).opts.initial,
		).toBe("");
	});
});