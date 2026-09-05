import { describe, expect, test } from "bun:test";
import {
	blankEffect,
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
});