import { describe, expect, test } from "bun:test";
import {
	StubArrayField,
	StubField,
} from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Origin } = await import("./origin");

// Bead w4gt: Origin.replaces is an ArrayField of strings, NOT a bare string.
// Into the Storm's expanded origins substitute EITHER of two chart slots
// (p17 "instead of the Scavenger or Savant entry"), so 13 pack docs author
// `replaces` as an array and 6 as a single string. Foundry's
// ArrayField._cast cleans a single string into a one-element array, so both
// shapes validate against this schema and normalise identically; runtime
// readers go through rules/origins.ts's replacedKeys.
describe("Origin data model", () => {
	test("replaces is an array-of-string field, not a bare string", () => {
		const schema = Origin.defineSchema() as unknown as Record<
			string,
			unknown
		>;
		const replaces = schema.replaces as StubArrayField;
		expect(replaces.of instanceof StubField).toBe(true);
		expect((replaces.of as StubField).opts.initial).toBe("");
		// Ordinary entries (no authored replaces) start empty, and falsiness is
		// preserved downstream by the mapper's normalisation to undefined.
		expect(replaces.opts.initial).toBeTypeOf("function");
	});
});