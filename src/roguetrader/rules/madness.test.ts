import { describe, expect, test } from "bun:test";
import {
	addAffliction,
	afflictionLedgerKind,
	corruptionTrack,
	dueDisorders,
	insanityTrack,
	malignancyTestsDue,
	mutationTestsDue,
	nextDisorderThreshold,
	nextMutationThreshold,
	traumaRoll,
	type TrackRowLike,
} from "./madness";

const track: TrackRowLike[] = [
	{ kind: "insanity-track", rollMin: 0, rollMax: 9, degree: "Stable", modifier: 0 },
	{ kind: "insanity-track", rollMin: 10, rollMax: 39, degree: "Unsettled", modifier: 10 },
	{ kind: "insanity-track", rollMin: 40, rollMax: 59, degree: "Disturbed", modifier: 0 },
	{ kind: "insanity-track", rollMin: 60, rollMax: 79, degree: "Unhinged", modifier: -10 },
	{ kind: "insanity-track", rollMin: 80, rollMax: 99, degree: "Deranged", modifier: -20 },
	{ kind: "insanity-track", rollMin: 100, rollMax: 999, degree: "Terminally Insane", modifier: -20 },
];
const corruption: TrackRowLike[] = [
	{ kind: "corruption-track", rollMin: 1, rollMax: 30, degree: "Tainted", modifier: 0 },
	{ kind: "corruption-track", rollMin: 31, rollMax: 60, degree: "Soiled", modifier: -10 },
	{ kind: "corruption-track", rollMin: 61, rollMax: 90, degree: "Debased", modifier: -20 },
	{ kind: "corruption-track", rollMin: 91, rollMax: 99, degree: "Profane", modifier: -30 },
	{ kind: "corruption-track", rollMin: 100, rollMax: 999, degree: "Damned", modifier: -30 },
];

describe("insanityTrack (Table 10-5)", () => {
	test("bands map to degrees and trauma-test modifiers", () => {
		expect(insanityTrack(track, 5)).toEqual({ degree: "Stable", modifier: 0 });
		expect(insanityTrack(track, 20)).toEqual({ degree: "Unsettled", modifier: 10 });
		expect(insanityTrack(track, 45)).toEqual({ degree: "Disturbed", modifier: 0 });
		expect(insanityTrack(track, 70)).toEqual({ degree: "Unhinged", modifier: -10 });
		expect(insanityTrack(track, 85)).toEqual({ degree: "Deranged", modifier: -20 });
	});

	test("boundary points land inside their band (0 and 100+)", () => {
		expect(insanityTrack(track, 0)).toEqual({ degree: "Stable", modifier: 0 });
		expect(insanityTrack(track, 9)).toEqual({ degree: "Stable", modifier: 0 });
		expect(insanityTrack(track, 10)).toEqual({ degree: "Unsettled", modifier: 10 });
		expect(insanityTrack(track, 99)).toEqual({ degree: "Deranged", modifier: -20 });
		expect(insanityTrack(track, 100)).toEqual({ degree: "Terminally Insane", modifier: -20 });
		expect(insanityTrack(track, 150)).toEqual({ degree: "Terminally Insane", modifier: -20 });
	});
});

describe("corruptionTrack (Table 10-7)", () => {
	test("bands map to degrees and malignancy-test modifiers", () => {
		expect(corruptionTrack(corruption, 10)).toEqual({ degree: "Tainted", modifier: 0 });
		expect(corruptionTrack(corruption, 35)).toEqual({ degree: "Soiled", modifier: -10 });
		expect(corruptionTrack(corruption, 95)).toEqual({ degree: "Profane", modifier: -30 });
	});

	test("boundary points: no tier at 0 CP, Damned at 100", () => {
		expect(corruptionTrack(corruption, 0)).toEqual({ degree: "", modifier: 0 });
		expect(corruptionTrack(corruption, 30)).toEqual({ degree: "Tainted", modifier: 0 });
		expect(corruptionTrack(corruption, 31)).toEqual({ degree: "Soiled", modifier: -10 });
		expect(corruptionTrack(corruption, 99)).toEqual({ degree: "Profane", modifier: -30 });
		expect(corruptionTrack(corruption, 100)).toEqual({ degree: "Damned", modifier: -30 });
	});

	test("next-threshold display helpers", () => {
		expect(nextDisorderThreshold(0)).toBe(40);
		expect(nextDisorderThreshold(40)).toBe(60);
		expect(nextDisorderThreshold(79)).toBe(80);
		expect(nextDisorderThreshold(80)).toBeNull();
		expect(nextMutationThreshold(0)).toBe(30);
		expect(nextMutationThreshold(29)).toBe(30);
		expect(nextMutationThreshold(30)).toBe(60);
		expect(nextMutationThreshold(89)).toBe(90);
		expect(nextMutationThreshold(90)).toBeNull();
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
describe("afflictionLedgerKind (drop classifier, bead rdh1)", () => {
	test("madness-pack kinds map to ledger kinds", () => {
		expect(afflictionLedgerKind({ kind: "disorder" })).toBe("disorder");
		expect(afflictionLedgerKind({ kind: "malignancy" })).toBe("malignancy");
	});

	test("mutation-pack rows map via tableKey", () => {
		expect(afflictionLedgerKind({ tableKey: "mutations" })).toBe("mutation");
		expect(afflictionLedgerKind({ kind: "mutation" })).toBe("mutation");
	});

	test("everything else is an ordinary item drop", () => {
		expect(afflictionLedgerKind({})).toBeNull();
		expect(afflictionLedgerKind({ kind: "shock-table" })).toBeNull();
		expect(afflictionLedgerKind({ tableKey: "criticals" })).toBeNull();
	});
});
