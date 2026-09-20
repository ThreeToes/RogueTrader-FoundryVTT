/**
 * The roll-system compatibility shim (epic kof0, phase 4; bead nkwa).
 *
 * rules/roll-system.ts is now a pure re-export, kept so the established import
 * paths keep working: rules/adapter.ts (which re-exports the roll API for the
 * sheets and the game.rogueTrader.* surface) and rules/battlesuit-repair.ts.
 *
 * The pipeline's own behaviour is tested against the REAL modules in
 * presentation/rolls/roll-pipeline.test.ts. Nothing else tests the shim, so a
 * dropped export would only surface at runtime as `undefined`. This pins it.
 *
 * The stubs must precede the imports because the pipeline loads test-dialog,
 * which touches foundry.applications at module load.
 */

const originalFoundry = (globalThis as Record<string, unknown>).foundry;
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { wait: async () => null, input: async () => null },
		},
	},
};

const shim = await import("./roll-system");
const perform = await import("../presentation/rolls/perform");
const { weaponHandler } = await import("../presentation/rolls/weapon");
const { resolveEvasion } = await import("../presentation/rolls/evasion");
const { dialogContributors, runTest } = await import(
	"../presentation/rolls/pipeline"
);

import { afterAll, describe, expect, test } from "bun:test";

afterAll(() => {
	if (originalFoundry === undefined) {
		delete (globalThis as Record<string, unknown>).foundry;
	} else {
		(globalThis as Record<string, unknown>).foundry = originalFoundry;
	}
});

/** Everything rules/adapter.ts re-exports for the sheets + game.rogueTrader.*. */
const ROLL_FUNCTIONS = [
	"rollTest",
	"rollSkill",
	"rollSkillUntrained",
	"rollWeaponAttack",
	"rollPsychicPower",
	"rollNavigatorPower",
	"rollFearTest",
	"rollSnapOut",
	"rollShipSalvo",
	"rollShipRepair",
	"performRoll",
	"rollSkillOutcome",
] as const;

const HANDLERS = [
	"characteristicHandler",
	"skillHandler",
	"weaponHandler",
	"psychicHandler",
	"navigatorHandler",
	"shipWeaponHandler",
	"shipRepairHandler",
	"fearHandler",
] as const;

describe("roll-system compatibility shim (bead nkwa)", () => {
	test("re-exports every roll function the established import paths use", () => {
		for (const name of ROLL_FUNCTIONS) {
			expect(typeof (shim as Record<string, unknown>)[name]).toBe("function");
		}
	});

	test("re-exports every handler plus the registry", () => {
		for (const name of HANDLERS) {
			expect((shim as Record<string, unknown>)[name]).toBeDefined();
		}
		expect(shim.rollHandlers).toBeDefined();
	});

	test("re-exports the pipeline helpers and evasion", () => {
		expect(typeof shim.dialogContributors).toBe("function");
		expect(typeof shim.runTest).toBe("function");
		expect(typeof shim.resolveEvasion).toBe("function");
	});

	test("re-exports the SAME objects, not copies of them", () => {
		expect(shim.weaponHandler).toBe(weaponHandler);
		expect(shim.resolveEvasion).toBe(resolveEvasion);
		expect(shim.dialogContributors).toBe(dialogContributors);
		expect(shim.runTest).toBe(runTest);
		expect(shim.performRoll).toBe(perform.performRoll);
		expect(shim.rollHandlers).toBe(perform.rollHandlers);
	});
});
