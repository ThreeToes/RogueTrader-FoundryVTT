/**
 * The rules app's context under a FOREIGN registry (bead w9sa.2).
 *
 * The app is the Foundry-coupled shell: every decision lives in the pure view
 * model and the pure pack parser, and this file pins the one thing those cannot
 * — that the shell resolves the ACTIVE system's registry rather than Rogue
 * Trader's, so a sibling system renders ITS knobs, ITS diff and ITS pack kind
 * through exactly the same code. Owner ruling stands (no render-level
 * ApplicationV2 tests), so this asserts on `_prepareContext`'s product, not on
 * HTML.
 *
 * WHY THE PROTOTYPE IS PATCHED: bun runs every suite in ONE process, so
 * `RulesApp` extends whichever `ApplicationV2` stub was global when the FIRST
 * suite loaded it — often a bare `class {}` with no `_prepareContext` of its
 * own. The base method is therefore stubbed on the REAL parent prototype
 * (`Object.getPrototypeOf(RulesApp.prototype)`) instead of assumed, exactly as
 * rules/test-dialog.test.ts does for the dialog shim.
 */

// --- Foundry/global stubs (must precede the dynamic import) ---------------
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
/** The stub world these tests swap per scenario. */
const stubGame = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string) => key,
	},
	system: { id: "rogue-trader", version: "9.9.9" },
	settings: { get: () => "" },
};
(globalThis as Record<string, unknown>).game = stubGame;
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { confirm: async () => true },
		},
	},
	utils: { saveDataToFile: () => undefined },
};
(globalThis as Record<string, unknown>).CONFIG = {
	ROGUE_TRADER: { ruleProfiles: () => [] },
};

const { RulesApp } = await import("./rules-app");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
} from "../../ffg/domain/rule-knobs";

/**
 * Run the app's `_prepareContext` with the base one stubbed, returning the
 * context object the template is handed.
 */
async function prepareContext(
	settings: Record<string, string>,
): Promise<Record<string, unknown>> {
	const parent = Object.getPrototypeOf(RulesApp.prototype) as Record<
		string,
		unknown
	>;
	const hadBase = Object.hasOwn(parent, "_prepareContext");
	const basePrepare = parent._prepareContext;
	parent._prepareContext = async () => ({});
	const hadRender = Object.hasOwn(RulesApp.prototype, "render");
	const baseRender = RulesApp.prototype.render;
	(RulesApp.prototype as { render?: unknown }).render = () =>
		Promise.resolve(undefined);
	(globalThis as Record<string, unknown>).game = {
		...stubGame,
		settings: {
			get: (_ns: string, key: string) => settings[key] ?? "",
		},
	};
	try {
		const app = new RulesApp();
		return (await app._prepareContext({})) as Record<string, unknown>;
	} finally {
		if (hadBase) parent._prepareContext = basePrepare;
		else delete parent._prepareContext;
		if (hadRender) RulesApp.prototype.render = baseRender;
		else delete (RulesApp.prototype as { render?: unknown }).render;
		(globalThis as Record<string, unknown>).game = stubGame;
	}
}

/** Flatten the context's generated knob form down to its knob keys. */
function groupKnobKeys(
	context: Record<string, unknown>,
): readonly string[] {
	const groups = (context.groups ?? []) as ReadonlyArray<{
		fields: ReadonlyArray<{ knob: { key: string } }>;
	}>;
	return groups.flatMap((group) => group.fields.map((field) => field.knob.key));
}

/**
 * A FAKE sibling registry, in the shape bead w9sa.3 authors DH2's for real:
 * its own Standard Attack knob where RT has a Semi-Auto Burst BONUS, a flat
 * untrained penalty where RT halves the characteristic, and no push cap at
 * all. Nothing in it matches an RT knob key, so an app that still renders
 * Rogue Trader's knobs cannot pass by accident.
 */
const SIBLING_REGISTRY = {
	systemId: "dark-heresy-2e",
	knobs: [
		{
			key: "combat.standardMode",
			path: ["fireModeBonus", "burst"],
			labelKey: "RULES.COMBAT_STANDARD_MODE",
			hintKey: "RULES.COMBAT_STANDARD_MODE.HINT",
			group: "combat",
			control: "number",
			hazard: "auto-recomputed",
			coreValue: 10,
		},
		{
			key: "skills.untrainedPenalty",
			path: ["untrainedSkill", "penalty"],
			labelKey: "RULES.SKILLS_UNTRAINED_PENALTY",
			hintKey: "RULES.SKILLS_UNTRAINED_PENALTY.HINT",
			group: "skills",
			control: "number",
			hazard: "auto-recomputed",
			coreValue: 20,
		},
	],
} as const;

describe("the app resolves the ACTIVE system's registry", () => {
	it("renders ROGUE TRADER's knobs with nothing registered", async () => {
		const context = await prepareContext({});
		const keys = groupKnobKeys(context);
		expect(keys).toContain("combat.fireModeBonus.burst");
		expect(keys).toContain("psychic.pushCap.sanctioned");
		expect(keys).not.toContain("combat.standardMode");
	});

	it("renders the SIBLING's knobs once IT is the registry in force", async () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		const context = await prepareContext({});
		expect(groupKnobKeys(context)).toEqual([
			"combat.standardMode",
			"skills.untrainedPenalty",
		]);
		// The generated form still groups, still carries the hint/hazard keys
		// and still shows the core value beside the control — the same shape,
		// a different registry.
		const groups = context.groups as ReadonlyArray<{
			group: string;
			labelKey: string;
			fields: ReadonlyArray<Record<string, unknown>>;
		}>;
		expect(groups.map((group) => group.group)).toEqual(["combat", "skills"]);
		const standard = groups[0]!.fields[0]!;
		expect(standard.labelKey).toBe("RULES.COMBAT_STANDARD_MODE");
		expect(standard.hintKey).toBe("RULES.COMBAT_STANDARD_MODE.HINT");
		expect(standard.hazardKey).toBe("RULES.HAZARD_AUTO_RECOMPUTED");
		expect(standard.coreDisplay).toEqual({
			none: false,
			isBoolean: false,
			yesNo: null,
			text: "10",
			bands: 0,
		});
	});

	it("stamps its export with the SIBLING system's pack kind", async () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		const context = await prepareContext({
			ruleProfiles: JSON.stringify([
				{
					id: "standard",
					name: "Standard mode",
					delta: { "combat.standardMode": -10 },
				},
			]),
			activeProfileId: "standard",
		});
		const text = String(context.packTextOut ?? "");
		expect(text).toContain('"kind": "dark-heresy-2e.rule-profiles"');
		expect(text).toContain('"combat.standardMode": -10');
	});

	it("keeps ROGUE TRADER's kind when nothing is registered", async () => {
		const context = await prepareContext({
			ruleProfiles: JSON.stringify([
				{
					id: "lethal",
					name: "Lethal",
					delta: { "combat.fireModeBonus.burst": 0 },
				},
			]),
			activeProfileId: "lethal",
		});
		expect(String(context.packTextOut)).toContain(
			'"kind": "rogue-trader.rule-profiles"',
		);
	});
});

afterEach(() => {
	resetRuleKnobRegistryForTests();
});
