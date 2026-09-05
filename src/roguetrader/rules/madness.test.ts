import { describe, expect, test } from "bun:test";
import {
	addAffliction,
	corruptionTrack,
	dueDisorders,
	insanityTrack,
	malignancyTestsDue,
	mutationTestsDue,
	traumaRoll,
	type TrackRowLike,
} from "./madness";

const track: TrackRowLike[] = [
	{ kind: "insanity-track", rollMin: 0, rollMax: 9, degree: "Stable", modifier: 0 },
	{ kind: "insanity-track", rollMin: 10, rollMax: 39, degree: "Unsettled", modifier: 10 },
	{ kind: "insanity-track", rollMin: 40, rollMax: 59, degree: "Disturbed", modifier: 0 },
	{ kind: "insanity-track", rollMin: 60, rollMax: 79, degree: "Unhinged", modifier: -10 },
	{ kind: "insanity-track", rollMin: 80, rollMax: 99, degree: "Deranged", modifier: -20 },
];
const corruption: TrackRowLike[] = [
	{ kind: "corruption-track", rollMin: 1, rollMax: 30, degree: "Tainted", modifier: 0 },
	{ kind: "corruption-track", rollMin: 31, rollMax: 60, degree: "Soiled", modifier: -10 },
	{ kind: "corruption-track", rollMin: 91, rollMax: 99, degree: "Profane", modifier: -30 },
];

describe("insanityTrack (Table 10-5)", () => {
	test("bands map to degrees and trauma-test modifiers", () => {
		expect(insanityTrack(track, 5)).toEqual({ degree: "Stable", modifier: 0 });
		expect(insanityTrack(track, 20)).toEqual({ degree: "Unsettled", modifier: 10 });
		expect(insanityTrack(track, 45)).toEqual({ degree: "Disturbed", modifier: 0 });
		expect(insanityTrack(track, 70)).toEqual({ degree: "Unhinged", modifier: -10 });
		expect(insanityTrack(track, 85)).toEqual({ degree: "Deranged", modifier: -20 });
	});
});

describe("corruptionTrack (Table 10-7)", () => {
	test("bands map to degrees and malignancy-test modifiers", () => {
		expect(corruptionTrack(corruption, 10)).toEqual({ degree: "Tainted", modifier: 0 });
		expect(corruptionTrack(corruption, 35)).toEqual({ degree: "Soiled", modifier: -10 });
		expect(corruptionTrack(corruption, 95)).toEqual({ degree: "Profane", modifier: -30 });
	});
});

describe("dueDisorders (p296: 40/60/80 IP)", () => {
	test("no disorders below 40 IP", () => {
		expect(dueDisorders(39, [])).toHaveLength(0);
	});

	test("first disorder due at 40, escalating at 60/80", () => {
		expect(dueDisorders(40, [])).toEqual([{ at: 40, severity: "Minor" }]);
		expect(dueDisorders(65, [])).toEqual([
			{ at: 40, severity: "Minor" },
			{ at: 60, severity: "Severe" },
		]);
	});

	test("ledger entries suppress already-gained severities", () => {
		const ledger = [{ kind: "disorder" as const, name: "Minor (Phobia)", text: "" }];
		expect(dueDisorders(40, ledger)).toHaveLength(0);
	});
});

describe("traumaRoll (Table 10-6)", () => {
	test("d100 plus 10 per degree of failure", () => {
		expect(traumaRoll(0, 30)).toBe(30);
		expect(traumaRoll(2, 30)).toBe(50);
		expect(traumaRoll(5, 90)).toBe(140);
	});
});

describe("malignancy and mutation tests (p299)", () => {
	test("malignancy test every 10 CP", () => {
		expect(malignancyTestsDue(9)).toBe(0);
		expect(malignancyTestsDue(10)).toBe(1);
		expect(malignancyTestsDue(31)).toBe(3);
	});

	test("mutation tests: two characteristics per 30 CP", () => {
		expect(mutationTestsDue(29)).toBe(0);
		expect(mutationTestsDue(30)).toBe(1);
		expect(mutationTestsDue(60)).toBe(2);
	});
});

describe("affliction ledger", () => {
	test("append without duplication", () => {
		const base = [{ kind: "malignancy" as const, name: "Palsy", text: "" }];
		expect(addAffliction(base, { kind: "malignancy", name: "Palsy", text: "" })).toBe(base);
		const grown = addAffliction(base, { kind: "malignancy", name: "Hatred", text: "" });
		expect(grown).toHaveLength(2);
	});
});