/**
 * The shared covering-row lookup (bead pbsv): one banded-table read for the
 * madness/corruption tracks and the mutation tables.
 *
 * Pure data in, row out — no Foundry, no ports.
 */
import { describe, expect, test } from "bun:test";

import { coveringRow } from "./chart";

const track = [
	{ kind: "insanity-track", rollMin: 0, rollMax: 9, degree: "Stable" },
	{ kind: "insanity-track", rollMin: 10, rollMax: 39, degree: "Unsettled" },
];
const mutations = [
	{ tableKey: "mutations", rollMin: 1, rollMax: 5, name: "Grotesque" },
	{ tableKey: "mutations", rollMin: 6, rollMax: 10, name: "Tough Hide" },
];

describe("coveringRow (bead pbsv)", () => {
	test("resolves the band covering the value, inclusive at both edges", () => {
		expect(coveringRow(track, "insanity-track", 0)?.degree).toBe("Stable");
		expect(coveringRow(track, "insanity-track", 9)?.degree).toBe("Stable");
		expect(coveringRow(track, "insanity-track", 10)?.degree).toBe("Unsettled");
	});

	test("honours a non-default key field", () => {
		expect(coveringRow(mutations, "mutations", 3, "tableKey")?.name).toBe(
			"Grotesque",
		);
		expect(coveringRow(mutations, "mutations", 50, "tableKey")).toBeNull();
	});

	test("key isolation and bands without a cover yield null", () => {
		expect(coveringRow(track, "trauma", 5)).toBeNull();
		expect(coveringRow(track, "insanity-track", 40)).toBeNull();
	});

	test("an absent band edge is open-ended", () => {
		expect(
			coveringRow([{ kind: "trauma", rollMin: 171 }], "trauma", 999),
		).not.toBeNull();
		expect(
			coveringRow([{ kind: "trauma", rollMax: 40 }], "trauma", 0),
		).not.toBeNull();
	});
});
