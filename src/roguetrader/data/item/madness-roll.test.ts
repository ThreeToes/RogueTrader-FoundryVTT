import { describe, expect, test } from "bun:test";
import { lookupMadnessRow } from "./madness-roll";

const track = [
	{ kind: "insanity-track", rollMin: 0, rollMax: 9, degree: "Stable" },
	{ kind: "insanity-track", rollMin: 10, rollMax: 39, degree: "Unsettled" },
	{ kind: "insanity-track", rollMin: 40, rollMax: 59, degree: "Disturbed" },
];
const traumas = [
	{ kind: "trauma", rollMin: 1, rollMax: 40, degree: "Withdrawn" },
	{ kind: "trauma", rollMin: 41, rollMax: 70, degree: "Compulsive Action" },
	{ kind: "trauma", rollMin: 171, rollMax: 999, degree: "Catatonia" },
];

describe("lookupMadnessRow (bead 06qc)", () => {
	test("insanity track bands resolve (0-9 stable, 40+ disturbed)", () => {
		expect(lookupMadnessRow(track, "insanity-track", 5)?.degree).toBe("Stable");
		expect(lookupMadnessRow(track, "insanity-track", 10)?.degree).toBe("Unsettled");
		expect(lookupMadnessRow(track, "insanity-track", 40)?.degree).toBe("Disturbed");
	});

	test("trauma rolls resolve including the 171+ tail", () => {
		expect(lookupMadnessRow(traumas, "trauma", 1)?.degree).toBe("Withdrawn");
		expect(lookupMadnessRow(traumas, "trauma", 45)?.degree).toBe("Compulsive Action");
		expect(lookupMadnessRow(traumas, "trauma", 999)?.degree).toBe("Catatonia");
	});

	test("kind isolation and no-cover yield null", () => {
		expect(lookupMadnessRow(track, "trauma", 5)).toBeNull();
		expect(lookupMadnessRow(traumas, "insanity-track", 5)).toBeNull();
	});
});
