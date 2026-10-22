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
// Bead wxut.7: the shim's _prepareContext override runs the base one, so the
// stub carries just enough of ApplicationV2 for it to resolve.
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				async _prepareContext(): Promise<Record<string, unknown>> {
					return {};
				}
			},
		},
	},
};

const {
	DIFFICULTY_LADDER,
	RT_TEST_DIALOG_BRANDING,
	TestDialog,
	TestDialogBase,
} = await import("./test-dialog");

// The stubs must not leak into other test files in the same bun process.
afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

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

	// Bead xu83: the pre-roll condition toggles and the acquisition procedures
	// must be localized in every shipped language (project i18n rule).
	it("has condition-toggle + procedure i18n keys in all languages", async () => {
		const keys = [
			"ROLL.CONDITIONS",
			"CONDITION.BRIGHT_LIGHT",
			"CONDITION.STRANGERS",
			"CONDITION.NORMALS",
			"CONDITION.NAUSEATED",
			"CONDITION.POISON_TESTS",
			"PROCEDURE.DEGENERATE_MIND",
			"PROCEDURE.MENTAL_REGRESSIVE",
		];
		for (const lang of ["en", "es", "fr", "pl"]) {
			const strings = (await import(
				`../../../lang/${lang}.json`
			)) as unknown as Record<string, string>;
			for (const key of keys) {
				expect(strings[key], `${lang} has ${key}`).toBeTruthy();
			}
		}
	});
});

describe("test-dialog system seams (bead p7jv)", () => {
	it("carries the RT branding (template path, window id/classes)", () => {
		expect(TestDialog.branding).toEqual(RT_TEST_DIALOG_BRANDING);
	});

	it("injects the RT ladder + i18n prefix as request defaults", () => {
		expect(TestDialog.defaults.difficultyLadder).toEqual(DIFFICULTY_LADDER);
		expect(TestDialog.defaults.difficultyLabelPrefix).toBe("ROLL.DIFFICULTY_");
	});

	it("leaves the base machinery neutral (empty branding, no defaults)", () => {
		expect(TestDialogBase.branding).toEqual({
			template: "",
			windowId: "test-dialog",
			// rt-component (cmio.6) is the shared component layer's root — inert
			// until a system bundles the shared CSS. rtk-window (cmio.7) is the
			// shared resize/clamp/scroll contract class.
			windowClasses: [
				"dialog",
				"test-dialog-app",
				"rt-component",
				"rtk-window",
			],
		});
		expect(TestDialogBase.defaults).toEqual({});
	});
});

/**
 * Run the RT shim's `_prepareContext` with a stand-in for the base one.
 *
 * bun runs every suite in ONE process, so `TestDialogBase` extends whichever
 * `ApplicationV2` stub was global when the FIRST suite loaded it — often a
 * bare `class {}` with no `_prepareContext` of its own. The base method is
 * therefore stubbed here rather than assumed.
 */
async function prepareContext(
	base: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const proto = TestDialogBase.prototype as unknown as Record<string, unknown>;
	const hadOwn = Object.hasOwn(proto, "_prepareContext");
	const original = proto._prepareContext;
	proto._prepareContext = async () => ({ ...base });
	try {
		const dialog = new TestDialog({ request: { title: "T", baseTarget: 30 } });
		const context = (await dialog._prepareContext({
			isFirstRender: false,
		})) as Record<string, unknown>;
		return context;
	} finally {
		if (hadOwn) proto._prepareContext = original;
		else delete proto._prepareContext;
	}
}

describe("the RT test-dialog template's house-rule block (bead wxut.7)", () => {
	it("renders the indicator, and renders nothing for core rules", async () => {
		// Same trap as the rules-app guard: `bun run verify:templates` renders
		// with an EMPTY context, so a body that only executes with data can
		// carry a broken expression unnoticed. The block is compiled here against
		// the shape _prepareContext hands it.
		const code = readFileSync("template/dialog/test-dialog.hbs", "utf8");
		const start = code.indexOf("{{#if profileIndicator}}");
		const end = code.indexOf("{{/if}}", start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const Handlebars = (await import("handlebars")).default;
		const compiled = Handlebars.compile(
			code.slice(start, end + "{{/if}}".length),
		);
		const html = compiled({
			profileIndicator: {
				name: "Lethal",
				overrideCount: 3,
				label: "House rules: Lethal (3 overrides)",
				hint: "Open the rules app",
			},
		});
		expect(html).toContain('data-action="openRules"');
		expect(html).toContain("House rules: Lethal (3 overrides)");
		expect(html).toContain("Open the rules app");
		// Core rules: the block is never entered — no chip, no divider.
		expect(compiled({})).not.toContain("openRules");
	});
});

describe("house-rule indicator in the RT header (bead wxut.7)", () => {
	it("keeps the base actions and adds the rules-app click-through", () => {
		expect(TestDialog.DEFAULT_OPTIONS.actions).toEqual({
			addModifier: expect.any(Function),
			removeModifier: expect.any(Function),
			updateModifier: expect.any(Function),
			updateDifficulty: expect.any(Function),
			roll: expect.any(Function),
			cancel: expect.any(Function),
			openRules: expect.any(Function),
		});
	});

	it("adds no indicator when core rules are active", async () => {
		// The stub world carries no settings surface at all, and the base
		// context is passed through untouched.
		const context = await prepareContext({ baseTarget: 30 });
		expect(context.profileIndicator).toBeNull();
		expect(context.baseTarget).toBe(30);
	});

	it("names the active profile when a house-rule profile is in force", async () => {
		const stored = JSON.stringify([
			{
				id: "lethal",
				name: "Lethal",
				delta: { "combat.fireModeBonus.burst": 15 },
			},
		]);
		(globalThis as Record<string, unknown>).game = {
			i18n: {
				localize: (key: string) => key,
				format: (key: string, vars?: Record<string, unknown>) =>
					`${key}:${vars?.name ?? ""}:${vars?.count ?? ""}`,
			},
			system: { id: "rogue-trader" },
			settings: {
				get: (_ns: string, key: string) =>
					key === "ruleProfiles" ? stored : "lethal",
			},
		};
		try {
			const context = await prepareContext({ baseTarget: 30 });
			expect(context.profileIndicator).toEqual({
				name: "Lethal",
				overrideCount: 1,
				label: "ROLL.HOUSE_RULES_ONE:Lethal:1",
				hint: "ROLL.HOUSE_RULES_HINT",
			});
		} finally {
			(globalThis as Record<string, unknown>).game = {
				i18n: {
					localize: (key: string) => key,
				},
			};
		}
	});
});
