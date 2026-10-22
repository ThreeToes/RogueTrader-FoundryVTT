/**
 * normaliseDamageType — the legacy/canonical normaliser (bead uvs5).
 *
 * Real consumers: the attack funnel's damage resolution (attack.ts), the
 * damage card's type label (adapter.ts) and emit-weapons-yaml. A wrong null
 * here silently blanks a card's damage-type label; a wrong mapping fakes
 * damage behaviour. Pure.
 */
import { describe, expect, test } from "bun:test";
import { DamageType, normaliseDamageType } from "./damage";

describe("normaliseDamageType (bead uvs5)", () => {
	test("full enum values round-trip", () => {
		expect(normaliseDamageType("Energy")).toBe(DamageType.Energy);
		expect(normaliseDamageType("Explosive")).toBe(DamageType.Explosive);
		expect(normaliseDamageType("Impact")).toBe(DamageType.Impact);
		expect(normaliseDamageType("Rending")).toBe(DamageType.Rending);
	});

	test("book letters map to the four types", () => {
		expect(normaliseDamageType("E")).toBe(DamageType.Energy);
		expect(normaliseDamageType("X")).toBe(DamageType.Explosive);
		expect(normaliseDamageType("I")).toBe(DamageType.Impact);
		expect(normaliseDamageType("R")).toBe(DamageType.Rending);
	});

	test("the legacy slash shorthand S maps to Rending", () => {
		// Table shorthand on early tables: S (the old slash-damage letter).
		expect(normaliseDamageType("S")).toBe(DamageType.Rending);
		expect(normaliseDamageType("s")).toBe(DamageType.Rending);
	});

	test("case-insensitive: x and Explosive in any case", () => {
		expect(normaliseDamageType("x")).toBe(DamageType.Explosive);
		expect(normaliseDamageType("EXPLOSIVE")).toBe(DamageType.Explosive);
		expect(normaliseDamageType("eNeRgY")).toBe(DamageType.Energy);
		expect(normaliseDamageType("iMpAcT")).toBe(DamageType.Impact);
	});

	test("whitespace is trimmed before matching", () => {
		expect(normaliseDamageType("  rending  ")).toBe(DamageType.Rending);
		expect(normaliseDamageType("\timpact\n")).toBe(DamageType.Impact);
	});

	test("empty, missing and unknown values return null", () => {
		expect(normaliseDamageType("")).toBeNull();
		expect(normaliseDamageType("   ")).toBeNull();
		expect(normaliseDamageType(undefined)).toBeNull();
		expect(normaliseDamageType(null)).toBeNull();
		expect(normaliseDamageType("banana")).toBeNull();
	});
});