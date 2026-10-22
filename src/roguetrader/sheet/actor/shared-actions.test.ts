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
import { readFileSync } from "node:fs";

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

	// Bead gyuj: rollSkillAction reads the enclosing row's data-item-id
	// (the shared itemIdFromTarget vocabulary), so the template's <li>
	// must keep the attribute — removing it silently no-ops every skill
	// roll. The rollSkill anchor's own data-item attribute was vestigial
	// (no handler reads it) and is deleted; the setLadder buttons' data-item
	// IS live (#onSetLadder reads it) and must remain.
	test("the skills tab's skill rows carry data-item-id for the roll handler (bead gyuj)", () => {
		const template = readFileSync(
			"template/sheet/actor/tabs/skills.hbs",
			"utf8",
		);
		const rowStart = template.indexOf('<li class="skill-row');
		expect(rowStart).toBeGreaterThan(-1);
		const row = template.slice(rowStart, template.indexOf("</li>", rowStart));
		// The handler's vocabulary: the id lives on the ROW.
		expect(row).toContain('data-item-id="{{skill.id}}"');
		// The vestigial anchor attribute stays deleted: after the gyuj cleanup
		// exactly ONE data-item="{{skill.id}}" remains in the whole template —
		// the setLadder button's.
		expect(template.match(/data-item="\{\{skill\.id\}\}"/g)).toHaveLength(1);
		expect(
			template.slice(template.indexOf('data-action="setLadder"')),
		).toContain('data-item="{{skill.id}}"');
	});
});