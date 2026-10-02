import { describe, expect, test } from "bun:test";

import { formatShipWeaponRange, normalizeShipWeaponRange } from "./ship-weapon-range";

// Bead 3atc (epic c48r): ship-weapon range became a min/max VU band.
// These pin the legacy-doc migration rule: a bare number (or numeric
// string, from hand edits) becomes a symmetric band — never dropped.

describe("normalizeShipWeaponRange (bead 3atc)", () => {
	test("a bare number migrates to a symmetric band (legacy world docs)", () => {
		expect(normalizeShipWeaponRange(9)).toEqual({ min: 9, max: 9 });
		expect(normalizeShipWeaponRange(0)).toEqual({ min: 0, max: 0 });
		expect(normalizeShipWeaponRange(40)).toEqual({ min: 40, max: 40 });
	});

	test("a numeric string also migrates (hand-edited values)", () => {
		expect(normalizeShipWeaponRange("12")).toEqual({ min: 12, max: 12 });
		expect(normalizeShipWeaponRange(" 6 ")).toEqual({ min: 6, max: 6 });
	});

	test("a non-numeric string and non-values fall back to 0/0 (never NaN)", () => {
		expect(normalizeShipWeaponRange("6-40")).toEqual({ min: 0, max: 0 });
		expect(normalizeShipWeaponRange("")).toEqual({ min: 0, max: 0 });
		expect(normalizeShipWeaponRange(null)).toEqual({ min: 0, max: 0 });
		expect(normalizeShipWeaponRange(undefined)).toEqual({ min: 0, max: 0 });
	});

	test("an object source passes through with coercion", () => {
		expect(normalizeShipWeaponRange({ min: 6, max: 40 })).toEqual({
			min: 6,
			max: 40,
		});
		expect(normalizeShipWeaponRange({ min: "6", max: "40" })).toEqual({
			min: 6,
			max: 40,
		});
		expect(normalizeShipWeaponRange({})).toEqual({ min: 0, max: 0 });
	});

	test("an inverted band is swapped, never clamped to 0", () => {
		expect(normalizeShipWeaponRange({ min: 40, max: 6 })).toEqual({
			min: 6,
			max: 40,
		});
	});

	test("result always matches the ShipWeaponRange read shape", () => {
		for (const input of [6, { min: 1, max: 2 }, "9", null]) {
			const got = normalizeShipWeaponRange(input);
			expect(typeof got.min).toBe("number");
			expect(typeof got.max).toBe("number");
			expect(got.min).toBeLessThanOrEqual(got.max);
		}
	});
});

describe("formatShipWeaponRange (bead gq2g)", () => {
	test("a single-value range (min === max) displays as one number", () => {
		expect(formatShipWeaponRange({ min: 9, max: 9 })).toBe("9");
		expect(formatShipWeaponRange({ min: 0, max: 0 })).toBe("0");
	});

	test("a band displays as 'min-max' — the book's own notation (BFK p34/p42)", () => {
		expect(formatShipWeaponRange({ min: 6, max: 40 })).toBe("6-40");
		expect(formatShipWeaponRange({ min: 6, max: 36 })).toBe("6-36");
	});

	test("legacy inputs (bare number, string, nullish) format safely — never [object Object]", () => {
		expect(formatShipWeaponRange(9)).toBe("9");
		expect(formatShipWeaponRange("12")).toBe("12");
		expect(formatShipWeaponRange(null)).toBe("0");
		expect(formatShipWeaponRange(undefined)).toBe("0");
	});

	test("an inverted band formats in the swapped (non-inverted) order", () => {
		expect(formatShipWeaponRange({ min: 40, max: 6 })).toBe("6-40");
	});
});