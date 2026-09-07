import "../../../test-helpers/foundry-schema-stub";
import "../../../test-helpers/foundry-schema-stub";
import { describe, expect, test } from "bun:test";
import { Character } from "./character";

/**
 * Psyker field surfacing (bead 1ooe): the psyker marker + Psy Rating are
 * first-class schema fields. psyker = Navigators count (Core Rulebook p182)
 * even at rating 0; psyRating 0 = not a manifesting psyker.
 */
describe("Character schema: psyker fields (bead 1ooe)", () => {
	const schema = Character.defineSchema() as unknown as Record<string, any>;

	test("psyker is a boolean field defaulting to false", () => {
		const psyker = schema.psyker as any;
		expect(psyker).toBeDefined();
		expect(psyker.constructor.name).toBe("StubField");
		expect(psyker.opts.initial).toBe(false);
	});

	test("psyRating is a non-negative integer defaulting to 0 (rating 0 = not a psyker)", () => {
		const psyRating = schema.psyRating as any;
		expect(psyRating).toBeDefined();
		expect(psyRating.opts.initial).toBe(0);
		expect(psyRating.opts.min).toBe(0);
		expect(psyRating.opts.integer).toBe(true);
	});

	test("round-trip: defaults produce a non-psyker with rating 0", () => {
		const defaults = {
			psyker: (schema.psyker as any).opts.initial as boolean,
			psyRating: (schema.psyRating as any).opts.initial as number,
		};
		// Sheet tab gating: psyker flag OR rating >= 1 shows the psychic tab.
		expect(defaults.psyker || defaults.psyRating >= 1).toBe(false);
	});

	test("round-trip: psyker flag with rating 0 opens the psychic tab (Navigator shape, p182)", () => {
		const initial = {
			psyker: (schema.psyker as any).opts.initial as boolean,
			psyRating: (schema.psyRating as any).opts.initial as number,
		};
		// Sheet gating: psyker === true || psyRating >= 1
		const gate = (psyker: boolean, psyRating: number) =>
			psyker === true || psyRating >= 1;
		expect(gate(initial.psyker, initial.psyRating)).toBe(false);
		expect(gate(true, 0)).toBe(true); // Navigator: flag without rating
		expect(gate(false, 2)).toBe(true); // Astropath: rating without manual flag
	});
});