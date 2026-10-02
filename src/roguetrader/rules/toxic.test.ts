import { describe, expect, test } from "bun:test";
import {
	TOXIC_PENALTY_PER_DAMAGE_POINT,
	toxicActivates,
	toxicToughnessModifier,
	toxicToughnessPenalty,
} from "./toxic";

describe("toxicActivates (bead d8bc, the damage-dealt gate)", () => {
	test("activates only when the quality is present AND damage was dealt", () => {
		expect(toxicActivates(true, 3)).toBe(true);
		expect(toxicActivates(true, 1)).toBe(true);
	});

	test("zero damage after Armour and Toughness reductions = no poison", () => {
		expect(toxicActivates(true, 0)).toBe(false);
		expect(toxicActivates(true, -2)).toBe(false);
	});

	test("a Toxic-less hit never activates, whatever the damage", () => {
		expect(toxicActivates(false, 7)).toBe(false);
	});
});

describe("toxicToughnessPenalty (bead d8bc, −5 per damage point)", () => {
	test("−5 per point of Damage taken", () => {
		expect(TOXIC_PENALTY_PER_DAMAGE_POINT).toBe(5);
		expect(toxicToughnessPenalty(1)).toBe(-5);
		expect(toxicToughnessPenalty(3)).toBe(-15);
		expect(toxicToughnessPenalty(10)).toBe(-50);
	});

	test("zero damage clamps to no penalty", () => {
		expect(toxicToughnessPenalty(0)).toBe(0);
	});

	test("negative damage clamps to 0, not a bonus", () => {
		expect(toxicToughnessPenalty(-4)).toBe(0);
	});

	test("non-finite damage fails loudly", () => {
		expect(() => toxicToughnessPenalty(Number.NaN)).toThrow();
	});
});

describe("toxicToughnessModifier (bead d8bc, visible funnel contributor)", () => {
	test("carries the penalty and flows as an effect-source modifier", () => {
		const mod = toxicToughnessModifier(4, "Toxic (−5 per Damage point)");
		expect(mod.id).toBe("toxic-toughness");
		expect(mod.source.type).toBe("effect");
		expect(mod.source.label).toBe("toxic");
		expect(mod.label).toBe("Toxic (−5 per Damage point)");
		expect(mod.value).toBe(-20);
	});

	test("zero damage yields a zero-value modifier (still visible)", () => {
		expect(toxicToughnessModifier(0, "Toxic").value).toBe(0);
	});
});