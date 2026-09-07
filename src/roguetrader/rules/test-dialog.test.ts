// Bead wqt3: difficulty ladder + dialog i18n wiring tests.
//
// test-dialog touches foundry.applications at module load, so the Foundry
// globals are stubbed BEFORE the dynamic import (same pattern as
// roll-system.test.ts).

// --- Foundry/global stubs (must precede the dynamic import) ---------------
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
	},
};
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
};

const { DIFFICULTY_LADDER } = await import("./test-dialog");

// The stubs must not leak into other test files in the same bun process.
afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, describe, expect, it } from "bun:test";

describe("DIFFICULTY_LADDER (bead wqt3)", () => {
	it("matches the Core Rulebook difficulty table (UNVERIFIED IN WORLD)", () => {
		expect([...DIFFICULTY_LADDER]).toEqual([
			{ key: "TRIVIAL", value: 60 },
			{ key: "EASY", value: 40 },
			{ key: "ROUTINE", value: 20 },
			{ key: "ORDINARY", value: 10 },
			{ key: "CHALLENGING", value: 0 },
			{ key: "HARD", value: -10 },
			{ key: "VERY_HARD", value: -20 },
			{ key: "ARDUOUS", value: -30 },
			{ key: "HELLISH", value: -40 },
		]);
	});

	it("is ordered from easiest to hardest", () => {
		for (let i = 1; i < DIFFICULTY_LADDER.length; i++) {
			expect(DIFFICULTY_LADDER[i].value).toBeLessThan(
				DIFFICULTY_LADDER[i - 1].value,
			);
		}
	});

	it("has ROLL.DIFFICULTY_* i18n keys in all languages", async () => {
		for (const lang of ["en", "es", "fr", "pl"]) {
			const strings = (await import(
				`../../../lang/${lang}.json`
			)) as unknown as Record<string, string>;
			expect(strings["ROLL.DIFFICULTY"]).toBeTruthy();
			expect(strings["ROLL.DIFFICULTY_NONE"]).toBeTruthy();
			for (const step of DIFFICULTY_LADDER) {
				expect(strings[`ROLL.DIFFICULTY_${step.key}`]).toBeTruthy();
			}
		}
	});
});