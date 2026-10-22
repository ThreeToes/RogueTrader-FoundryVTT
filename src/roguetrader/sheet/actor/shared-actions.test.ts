/**
 * Shared sheet roll actions (bead z4df): the characteristic and skill roll
 * bodies BOTH sheets carried verbatim now live in shared-actions.ts; the
 * sheets keep only their action names (templates depend on them). The pin
 * here is the wiring: each sheet's roll actions must reference the SAME
 * shared functions, or the two sheets have drifted apart again.
 *
 * Foundry-coupled module (imports the adapter), so the foundry global gets
 * the same stub pattern creators.test.ts uses. NOTE: no mock.module here —
 * bun test runs all files in one process and a module mock leaks into every
 * later test file.
 */
import { afterAll, describe, expect, test } from "bun:test";

const originalGlobals = {
	foundry: (globalThis as Record<string, unknown>).foundry,
	game: (globalThis as Record<string, unknown>).game,
};

(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		sheets: { ActorSheetV2: class {} },
		apps: { FilePicker: class {} },
	},
	documents: {
		Actor: class {},
		Item: class {},
		ChatMessage: { get: () => undefined },
	},
	utils: { mergeObject: () => undefined },
	config: {},
	hooks: { on() { /* stub */ } },
	game: { i18n: { localize: (k: string) => k, format: (k: string) => k } },
};
(globalThis as Record<string, unknown>).game = {
	foundry: { utils: { mergeObject: () => undefined } },
	i18n: { localize: (k: string) => k, format: (k: string) => k },
};

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

describe("shared roll actions wiring (bead z4df)", () => {
	test("both sheets' characteristic/skill actions reference the shared bodies", async () => {
		// All imports are dynamic: the foundry global stub must exist BEFORE
		// these modules load (static imports would hoist past it).
		const shared = (await import("./shared-actions")) as unknown as {
			rollCharacteristicAction: unknown;
			rollSkillAction: unknown;
		};
		const { CharacterSheet } = await import("./character-sheet");
		const { NpcSheet } = await import("./npc-sheet");
		const charActions = (
			CharacterSheet as unknown as {
				DEFAULT_OPTIONS: { actions: Record<string, unknown> };
			}
		).DEFAULT_OPTIONS.actions;
		const npcActions = (
			NpcSheet as unknown as {
				DEFAULT_OPTIONS: { actions: Record<string, unknown> };
			}
		).DEFAULT_OPTIONS.actions;
		expect(charActions.rollTest).toBe(shared.rollCharacteristicAction);
		expect(charActions.rollSkill).toBe(shared.rollSkillAction);
		expect(npcActions.rollNpcTest).toBe(shared.rollCharacteristicAction);
		expect(npcActions.rollNpcSkill).toBe(shared.rollSkillAction);
	});
});