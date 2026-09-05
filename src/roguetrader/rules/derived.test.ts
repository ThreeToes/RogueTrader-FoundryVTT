import { describe, expect, test } from "bun:test";
import {
	corruptionThreshold,
	fatigueThreshold,
	insanityThreshold,
	woundsMax,
} from "./derived";

const char = {
	characteristics: {
		t: { value: 45, unnatural: 1 }, // TB 4
		s: { value: 30, unnatural: 1 }, // SB 3
	},
};

describe("derived character values", () => {
	describe("woundsMax", () => {
		test("(SB + TB) x 2 + Sound Constitution levels", () => {
			expect(woundsMax(char)).toBe(14); // (3+4)*2
			const withTalent = woundsMax(char, [
				{
					type: "talent",
					name: "Sound Constitution",
					system: { effects: [{ kind: "wounds-max" }, { kind: "wounds-max" }] },
				},
				{
					type: "talent",
					name: "Unrelated",
					system: {
						effects: [{ kind: "test-modifier", testKey: "bs", value: 5 }],
					},
				},
			]);
			expect(withTalent).toBe(16);
		});

		// Bead yb6: gear-family items count only when equipped.
		test("equipped gear contributes, stowed does not", () => {
			const gearItem = (equipState: string) => ({
				type: "gear",
				name: "Soothing Balm",
				system: {
					equipState,
					effects: [{ kind: "wounds-max", value: 2 }],
				},
			});
			expect(woundsMax(char, [gearItem("carried")])).toBe(16);
			expect(woundsMax(char, [gearItem("stowed")])).toBe(14);
		});
	});

	test("fatigueThreshold = TB", () => {
		expect(fatigueThreshold(char)).toBe(4);
	});

	test("corruption/insanity thresholds are not guessed", () => {
		expect(corruptionThreshold(char)).toBeNull();
		expect(insanityThreshold(char)).toBeNull();
	});
});
