import { describe, expect, test } from "bun:test";
import {
	evaluatePrerequisites,
	parsePrerequisites,
} from "./prereq";

const actor = (chars: Record<string, number>, talents: string[] = [], psyRating = 0) => ({
	characteristics: chars,
	talents: talents.map((t) => t.toLowerCase()),
	psyRating,
});

describe("parsePrerequisites (Core Rulebook Table 4-1 grammar)", () => {
	test("empty and dash mean no prerequisites", () => {
		expect(parsePrerequisites("").groups).toHaveLength(0);
		expect(parsePrerequisites("—").groups).toHaveLength(0);
	});

	test("characteristic thresholds parse with book tokens", () => {
		const parsed = parsePrerequisites("Fel 30");
		expect(parsed.groups).toEqual([
			[{ kind: "characteristic", key: "fel", value: 30 }],
		]);
		expect(parsePrerequisites("Willpower 40").groups).toEqual([
			[{ kind: "characteristic", key: "wp", value: 40 }],
		]);
	});

	test("talent-chain prereqs parse as names", () => {
		const parsed = parsePrerequisites("Acrobatic");
		expect(parsed.groups).toEqual([[{ kind: "talent", name: "Acrobatic" }]]);
	});

	test("psy rating prereqs parse", () => {
		expect(parsePrerequisites("Psy Rating 2").groups).toEqual([
			[{ kind: "psyRating", value: 2 }],
		]);
	});

	test("comma = AND, or = OR group", () => {
		const parsed = parsePrerequisites("Acrobatic, Ag 40 or Fel 40");
		expect(parsed.groups).toEqual([
			[{ kind: "talent", name: "Acrobatic" }],
			[
				{ kind: "characteristic", key: "ag", value: 40 },
				{ kind: "characteristic", key: "fel", value: 40 },
			],
		]);
	});

	test("specials parse as talent-name atoms", () => {
		const parsed = parsePrerequisites("Mechanicus Implants");
		expect(parsed.groups).toEqual([[{ kind: "talent", name: "Mechanicus Implants" }]]);
	});

	test("raw string is preserved for display", () => {
		expect(parsePrerequisites("Fel 30").raw).toBe("Fel 30");
	});
});

describe("evaluatePrerequisites (soft enforcement, bead tfk)", () => {
	test("characteristic thresholds compare against actor values", () => {
		const parsed = parsePrerequisites("Fel 30");
		expect(evaluatePrerequisites(parsed, actor({ fel: 30 })).met).toBe(true);
		expect(evaluatePrerequisites(parsed, actor({ fel: 29 })).met).toBe(false);
	});

	test("OR groups pass when any alternative is met", () => {
		const parsed = parsePrerequisites("Ag 40 or Fel 40");
		expect(evaluatePrerequisites(parsed, actor({ fel: 40, ag: 10 })).met).toBe(true);
		expect(evaluatePrerequisites(parsed, actor({ ag: 30, fel: 30 })).met).toBe(false);
	});

	test("AND groups both need to pass", () => {
		const parsed = parsePrerequisites("Acrobatic, Ag 40");
		expect(
			evaluatePrerequisites(parsed, actor({ ag: 40 }, ["Acrobatic"])).met,
		).toBe(true);
		expect(
			evaluatePrerequisites(parsed, actor({ ag: 40 })).met,
		).toBe(false);
		expect(
			evaluatePrerequisites(parsed, actor({ ag: 10 }, ["Acrobatic"])).met,
		).toBe(false);
	});

	test("talent names match case-insensitively", () => {
		const parsed = parsePrerequisites("Jaded");
		expect(evaluatePrerequisites(parsed, actor({}, ["jaded"])).met).toBe(true);
	});

	test("psy rating thresholds use the actor's rating", () => {
		const parsed = parsePrerequisites("Psy Rating 2");
		expect(evaluatePrerequisites(parsed, actor({}, [], 2)).met).toBe(true);
		expect(evaluatePrerequisites(parsed, actor({}, [], 1)).met).toBe(false);
	});

	test("unmet groups surface as readable descriptions", () => {
		const parsed = parsePrerequisites("Acrobatic, Ag 40 or Fel 40");
		const result = evaluatePrerequisites(parsed, actor({ ag: 30, fel: 30 }));
		expect(result.unmet).toEqual([
			"Acrobatic",
			"AG 40 OR FEL 40",
		]);
	});

	test("no prerequisites always met", () => {
		expect(evaluatePrerequisites(parsePrerequisites("—"), actor({})).met).toBe(true);
	});
});