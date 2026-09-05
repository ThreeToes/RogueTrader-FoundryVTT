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
	// Bead hbu: the book's wounds formula (2xTB + 1d5(+N), rt_core p17-24)
	// is applied at creation and stored; TB 4 with a rolled 1d5=6 (Death
	// World, 1d5+2) gives 14 as the stored base.
	wounds: { max: 14 },
};

describe("derived character values", () => {
	describe("woundsMax", () => {
		test("stored base + Sound Constitution levels (bead hbu: book formula)", () => {
			expect(woundsMax(char)).toBe(14); // stored base (2xTB + 1d5+2)
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
