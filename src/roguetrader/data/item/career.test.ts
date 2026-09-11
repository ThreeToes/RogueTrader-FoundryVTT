import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { Career } = await import("./career");

import { careers } from "../../registry";

describe("Career data model", () => {
	test("core-8 careers are seeded in the registry", () => {
		for (const key of [
			"rogue-trader",
			"arch-militant",
			"astropath-transcendent",
			"explorator",
			"missionary",
			"navigator",
			"seneschal",
			"void-master",
		]) {
			expect(careers.has(key)).toBe(true);
		}
		expect(careers.keys()).toHaveLength(8);
	});

	test("schema carries the agreed fields (bead 2n5)", () => {
		const schema = Career.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		for (const field of [
			"key",
			"shortDescription",
			"description",
			"source",
			"characteristicAdvances",
			"startingSkills",
			"startingTalents",
			"startingGear",
			"ranks",
			// koau schema prerequisite: xenos careers (SR Table 4-1, NP Kroot
			// p50) generate 2d10+X per characteristic instead of human 25.
			"species",
		]) {
			expect(schema[field]).toBeDefined();
		}
	});

	test("species block shape: blank key = human, per-char 2d10+ adds (koau)", () => {
		const schema = Career.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const species = schema.species as unknown as {
			fields: Record<string, StubField>;
		};
		// Blank species key = human; consumers fall back to the human
		// defaults and origin fate tables.
		expect(species.fields.key.opts.initial).toBe("");
		expect(species.fields.label.opts.initial).toBe("");
		// baseCharacteristic adds default to the human 25.
		expect(species.fields.baseCharacteristics.of.opts.initial).toBe(25);
		// startingFate 0 = not specified (use origin rules); SR Dark Eldar
		// begin with 1 (captured as 1 in the pack data).
		expect(species.fields.startingFate.opts.initial).toBe(0);
		// woundsFormula is verbatim book text, blank for humans.
		expect(species.fields.woundsFormula.opts.initial).toBe("");
	});

	test("ranks array carries rank/xpLevel/advances with advance subfields", () => {
		const schema = Career.defineSchema() as unknown as Record<
			string,
			StubField
		>;
		const rankSlot = schema.ranks.of as {
			fields: Record<string, StubField>;
		};
		expect(rankSlot.fields.rank).toBeDefined();
		expect(rankSlot.fields.xpLevel).toBeDefined();
		const advances = rankSlot.fields.advances as unknown as { of: unknown };
		const advSlot = advances.of as { fields: Record<string, StubField> };
		for (const field of [
			"key",
			"name",
			"type",
			"cost",
			"multiplier",
			"prerequisites",
		]) {
			expect(advSlot.fields[field]).toBeDefined();
		}
	});

	test("rank helpers sort and look up", () => {
		const c = Object.create(Career.prototype) as InstanceType<
			typeof Career
		> & {
			ranks: Array<Record<string, unknown>>;
		};
		c.ranks = [
			{ rank: 2, xpLevel: 7000, advances: [] },
			{ rank: 1, xpLevel: 5000, advances: [] },
		];
		expect(c.sortedRanks.map((r) => r.rank)).toEqual([1, 2]);
		expect(c.rankEntry(2)?.xpLevel).toBe(7000);
		expect(c.rankEntry(9)).toBeUndefined();
	});
});