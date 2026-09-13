import { describe, expect, test } from "bun:test";
import {
	matchRollMap,
	parseRollMap,
	resultLabelFromRow,
	rollMatchesRange,
} from "./planet-tables";

describe("planet creator draw helpers", () => {
	describe("rollMatchesRange (bead 11iu)", () => {
		test("single results match exactly", () => {
			expect(rollMatchesRange("1 (Rocky)", 1)).toBe(true);
			expect(rollMatchesRange("1 (Rocky)", 2)).toBe(false);
			expect(rollMatchesRange("10", 10)).toBe(true);
			expect(rollMatchesRange("10", 9)).toBe(false);
		});

		test("ranges match within bounds", () => {
			expect(rollMatchesRange("2-3 (Rocky)", 2)).toBe(true);
			expect(rollMatchesRange("2-3 (Rocky)", 3)).toBe(true);
			expect(rollMatchesRange("2-3 (Rocky)", 4)).toBe(false);
			expect(rollMatchesRange("8-9", 8)).toBe(true);
		});

		test("non-numeric rows never match a numeric draw", () => {
			expect(rollMatchesRange("—", 1)).toBe(false);
			expect(rollMatchesRange("Success", 1)).toBe(false);
			expect(rollMatchesRange("Eldar", 1)).toBe(false);
			expect(rollMatchesRange("Humans", 3)).toBe(false);
		});

		test("whitespace between range bounds is tolerated", () => {
			expect(rollMatchesRange("2 - 3", 2)).toBe(true);
			expect(rollMatchesRange("2 - 3", 3)).toBe(true);
			expect(rollMatchesRange("2 - 3", 1)).toBe(false);
		});
	});

	describe("resultLabelFromRow", () => {
		test("strips the table prefix at the em-dash", () => {
			expect(
				resultLabelFromRow("Planet Body — Rocky 2-3 Small"),
			).toBe("Rocky 2-3 Small");
			expect(
				resultLabelFromRow("Inhabitants (Table 1-26) — Eldar"),
			).toBe("Eldar");
		});

		test("names without an em-dash pass through unchanged", () => {
			expect(resultLabelFromRow("Bare Row Name")).toBe("Bare Row Name");
		});
	});
});
describe("open-ended SOI roll expressions (owner bug report)", () => {
	test("'N or lower' bounds above", () => {
		expect(rollMatchesRange("2 or lower (Rocky)", 0)).toBe(true);
		expect(rollMatchesRange("2 or lower (Rocky)", 2)).toBe(true);
		expect(rollMatchesRange("2 or lower (Rocky)", 3)).toBe(false);
		expect(rollMatchesRange("45 or lower (Rocky)", 45)).toBe(true);
		expect(rollMatchesRange("45 or lower (Rocky)", 46)).toBe(false);
	});

	test("'N or higher'/'N or more'/'N+' bound below", () => {
		expect(rollMatchesRange("9+ (Rocky)", 9)).toBe(true);
		expect(rollMatchesRange("9+ (Rocky)", 12)).toBe(true);
		expect(rollMatchesRange("9+ (Rocky)", 8)).toBe(false);
		expect(rollMatchesRange("10 or higher", 10)).toBe(true);
		expect(rollMatchesRange("91 or more (Rocky)", 91)).toBe(true);
		expect(rollMatchesRange("91 or more (Rocky)", 90)).toBe(false);
	});

	test("percentile ranges treat '00' as 100", () => {
		expect(rollMatchesRange("86-00 (Gas Giant)", 86)).toBe(true);
		expect(rollMatchesRange("86-00 (Gas Giant)", 100)).toBe(true);
		expect(rollMatchesRange("86-00 (Gas Giant)", 85)).toBe(false);
		expect(rollMatchesRange("01-20 (Gas Giant)", 1)).toBe(true);
		expect(rollMatchesRange("01-20 (Gas Giant)", 20)).toBe(true);
		expect(rollMatchesRange("01-20 (Gas Giant)", 21)).toBe(false);
	});

	test("modified results outside the die face range still match open bounds", () => {
		// Climate 10 + 2 → 12 matches "11 or higher"; 1 − 1 → 0 matches "0 or lower".
		expect(rollMatchesRange("11 or higher", 12)).toBe(true);
		expect(rollMatchesRange("0 or lower", 0)).toBe(true);
	});
});

describe("parseRollMap (prose roll maps on reference rows)", () => {
	test("inhabitants map resolves species by die result", () => {
		const map = parseRollMap(
			"1 Eldar, 2-4 Humans, 5 Kroot†, 6-7 Orks†, 8 Rak'Gol, 9-10 Xenos (Other).",
		);
		expect(map).not.toBeNull();
		expect(matchRollMap(map, 1)).toBe("Eldar");
		expect(matchRollMap(map, 3)).toBe("Humans");
		expect(matchRollMap(map, 5)).toBe("Kroot");
		expect(matchRollMap(map, 7)).toBe("Orks");
		expect(matchRollMap(map, 8)).toBe("Rak'Gol");
		expect(matchRollMap(map, 10)).toBe("Xenos (Other)");
	});

	test("development sub-tables parse per species", () => {
		const map = parseRollMap(
			"1-3 Primitive Clans (Exodites)††, 4-8 Orbital Habitation, 9-10 Voidfarers.",
		);
		expect(matchRollMap(map, 2)).toBe("Primitive Clans (Exodites)");
		expect(matchRollMap(map, 8)).toBe("Orbital Habitation");
		expect(matchRollMap(map, 10)).toBe("Voidfarers");
	});

	test("unparseable prose (ellipsis ranges) yields null, not a crash", () => {
		expect(parseRollMap("1 Advanced Industry … 10 Voidfarers")).toBeNull();
	});

	test("empty text yields null", () => {
		expect(parseRollMap("")).toBeNull();
	});
});
