import { describe, expect, test } from "bun:test";
import { parseQualities, parseRateOfFire } from "../utils/emit-weapons-yaml";

describe("parseRateOfFire (book notation -> schema record)", () => {
	test("S/3/10 -> single + burst 3 + full auto 10", () => {
		expect(parseRateOfFire("S/3/10")).toEqual({
			singleShot: true,
			burst: 3,
			fullAuto: 10,
		});
	});

	test("S/–/– -> single shot only", () => {
		expect(parseRateOfFire("S/–/–")).toEqual({
			singleShot: true,
			burst: 0,
			fullAuto: 0,
		});
	});

	test("–/–/10 -> full auto only (heavy weapons)", () => {
		expect(parseRateOfFire("–/–/10")).toEqual({
			singleShot: false,
			burst: 0,
			fullAuto: 10,
		});
	});
});

describe("parseQualities (book names -> registry keys)", () => {
	test("simple list", () => {
		expect(parseQualities("Accurate, Reliable")).toEqual(["accurate", "reliable"]);
	});

	test("strips footnote daggers and maps display names", () => {
		expect(parseQualities("Primitive, Unreliable†")).toEqual([
			"primitive",
			"unreliable",
		]);
	});

	test("parameterised Blast becomes blast-N", () => {
		expect(parseQualities("Blast (1), Tearing")).toEqual(["blast-1", "tearing"]);
	});

	test("Overheat maps to the overheats registry key", () => {
		expect(parseQualities("Overheat")).toEqual(["overheats"]);
	});

	test("empty and dash-only specials yield empty arrays", () => {
		expect(parseQualities("")).toEqual([]);
		expect(parseQualities("—")).toEqual([]);
	});

	test("unmapped qualities throw loudly", () => {
		expect(() => parseQualities("Made-up Quality")).toThrow(/unmapped weapon quality/);
	});
});