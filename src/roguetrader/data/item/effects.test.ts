import { describe, expect, test } from "bun:test";
import {
	blankEffect,
	corruptionExpressions,
	effectsAreLive,
	withAddedEffect,
	withoutEffectAt,
	type EffectData,
} from "./effects";

describe("effect list helpers (sheets' add/remove controls)", () => {
	test("blankEffect mirrors the schema defaults", () => {
			expect(blankEffect()).toEqual({
			kind: "test-modifier",
			testKey: "",
			value: 0,
			dice: "",
			label: "",
			condition: "",
		});
	});

	test("withAddedEffect appends a blank row without mutating the input", () => {
		const existing: EffectData[] = [
			{ kind: "test-modifier", testKey: "bs", value: 5, label: "X", condition: "" },
		];
		const result = withAddedEffect(existing);
		expect(result).toHaveLength(2);
		expect(result[1]).toEqual(blankEffect());
		expect(existing).toHaveLength(1);
	});

	test("withAddedEffect handles undefined effects (fresh items)", () => {
		expect(withAddedEffect(undefined)).toEqual([blankEffect()]);
	});

	test("withoutEffectAt removes only the indexed row", () => {
		const list: EffectData[] = [
			{ kind: "test-modifier", testKey: "", value: 1, label: "a", condition: "" },
			{ kind: "test-modifier", testKey: "", value: 2, label: "b", condition: "" },
			{ kind: "test-modifier", testKey: "", value: 3, label: "c", condition: "" },
		];
		expect(withoutEffectAt(list, 1).map((e) => e.label)).toEqual(["a", "c"]);
		// Out-of-range indices leave the list untouched.
		expect(withoutEffectAt(list, 99)).toHaveLength(3);
	});

	describe("corruptionExpressions (epic 0hap)", () => {
		test("collects dice expressions from corruption rows", () => {
			expect(
				corruptionExpressions([
					{ kind: "corruption", dice: "1d10+4" },
					{ kind: "test-modifier", dice: "1d5" },
					{ kind: "corruption", value: 2 },
				]),
			).toEqual(["1d10+4", "2"]);
		});

		test("ignores blanks and absent effects", () => {
			expect(corruptionExpressions(undefined)).toEqual([]);
			expect(
				corruptionExpressions([{ kind: "corruption", dice: "  " }]),
			).toEqual([]);
		});
	});
});

describe("effectsAreLive (epic nt8k)", () => {
	test("afflictions are innate: owned means live, no equip state", () => {
		expect(effectsAreLive("mutation", undefined)).toBe(true);
		expect(effectsAreLive("madnessentry", undefined)).toBe(true);
		expect(effectsAreLive("madnessentry", "stowed")).toBe(true);
	});

	test("physical items still require their equip state", () => {
		expect(effectsAreLive("gear", "stowed")).toBe(false);
		expect(effectsAreLive("gear", "carried")).toBe(true);
	});
});