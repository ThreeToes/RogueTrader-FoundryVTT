/**
 * Composition-root smoke test (epic kof0, beads mnky + 1dj1).
 *
 * The phase-5 split moved ~500 lines of wiring into bootstrap/. None of it was
 * tested, and the composition root fails in a way nothing else catches: a
 * dropped register* call, a mistyped CONFIG key or an unregistered document
 * type produces no build error and no failing unit test — the system just
 * silently loses a sheet, a status, a warmer or an API method.
 *
 * Everything Foundry-shaped is stubbed here, so this runs headless.
 */

import { afterAll, describe, expect, test } from "bun:test";

// --- Foundry stubs (before importing the composition root) ----------------

type HookFn = (...args: never[]) => unknown;

const hooks = {
	once: new Map<string, HookFn[]>(),
	on: new Map<string, HookFn[]>(),
};

const config: Record<string, unknown> = {
	Item: { dataModels: {} },
	Actor: { dataModels: {} },
	statusEffects: [{ id: "core-thing" }],
};

const settings: Array<{ ns: string; key: string }> = [];

const registeredSheets: Array<{
	className: string;
	types: string[];
	label: string;
	makeDefault: boolean;
}> = [];

const globals = globalThis as Record<string, unknown>;
const saved = {
	Hooks: globals.Hooks,
	CONFIG: globals.CONFIG,
	game: globals.game,
	foundry: globals.foundry,
	ui: globals.ui,
	document: globals.document,
	Handlebars: globals.Handlebars,
};

class FakeItem {
	static name = "Item";
}
class FakeActor {
	static name = "Actor";
}

globals.Hooks = {
	once: (name: string, fn: HookFn) => {
		hooks.once.set(name, [...(hooks.once.get(name) ?? []), fn]);
	},
	on: (name: string, fn: HookFn) => {
		hooks.on.set(name, [...(hooks.on.get(name) ?? []), fn]);
	},
};
globals.CONFIG = config;
globals.game = {
	system: { id: "rogue-trader", documentTypes: {} },
	settings: {
		register: (ns: string, key: string) => {
			settings.push({ ns, key });
		},
		get: () => "",
	},
	documentTypes: { Actor: ["pc", "explorer"] },
};
globals.document = { body: { addEventListener: () => undefined } };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { wait: async () => null, input: async () => null },
		},
		sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
		handlebars: {
			renderTemplate: async () => "<div></div>",
			getTemplate: async () => () => "",
		},
		apps: {
			DocumentSheetConfig: {
				registerSheet: (
					documentClass: { name: string },
					_scope: string,
					_sheet: unknown,
					options: { types: string[]; label: string; makeDefault: boolean },
				) => {
					registeredSheets.push({
						className: documentClass.name,
						types: options.types,
						label: options.label,
						makeDefault: options.makeDefault,
					});
				},
			},
		},
	},
	documents: { Item: FakeItem, Actor: FakeActor },
	abstract: { TypeDataModel: class {} },
	dice: { Roll: class {} },
	utils: { mergeObject: () => undefined },
};
globals.ui = { notifications: { warn: () => undefined, info: () => undefined } };
globals.Handlebars = {
	registerHelper: () => undefined,
	registerPartial: () => undefined,
	helpers: {},
	partials: {},
};

const { sheetInit } = await import("./index");
const { SHEET_REGISTRY } = await import("./sheet-registry");

// --- Helpers --------------------------------------------------------------

/** Fire every callback registered for a hook. */
function fire(name: string, ...args: unknown[]): void {
	for (const fn of hooks.once.get(name) ?? []) fn(...(args as never[]));
	for (const fn of hooks.on.get(name) ?? []) fn(...(args as never[]));
}

// --- Tests ----------------------------------------------------------------

describe("composition root (beads mnky + 1dj1)", () => {
	test("sheetInit registers a single init hook", () => {
		sheetInit();
		expect(hooks.once.get("init")).toHaveLength(1);
	});

	test("the init hook wires everything without throwing", () => {
		// Firing init must not throw: that alone catches a bad CONFIG shape,
		// a missing import or an unguarded Foundry global.
		expect(() => fire("init")).not.toThrow();
	});

	test("replaces the core status list with the system statuses (p0af)", () => {
		const statuses = config.statusEffects as Array<{
			id: string;
			name: string;
			img: string;
			statuses: string[];
		}>;
		expect(statuses.length).toBeGreaterThan(0);
		expect(statuses.some((s) => s.id === "core-thing")).toBe(false);
		for (const status of statuses) {
			expect(status.id).toBeTruthy();
			expect(status.name).toBeTruthy();
			expect(status.img).toBeTruthy();
			expect(status.statuses).toEqual([status.id]);
		}
	});

	test("registers every SHEET_REGISTRY type as a data model", () => {
		// Table-driven on purpose: a new type cannot silently skip registration.
		const itemModels = (config.Item as { dataModels: Record<string, unknown> })
			.dataModels;
		const actorModels = (config.Actor as { dataModels: Record<string, unknown> })
			.dataModels;
		for (const [type, entry] of Object.entries(SHEET_REGISTRY.Item)) {
			expect(itemModels[type]).toBe(entry.model);
		}
		for (const [type, entry] of Object.entries(SHEET_REGISTRY.Actor)) {
			expect(actorModels[type]).toBe(entry.model);
		}
	});

	test("keeps the legacy pc model at init (it must survive boot)", () => {
		// The complementary assertion — that ready DROPS it — belongs to the
		// migration path; at init it must still be registered.
		const actorModels = (config.Actor as { dataModels: Record<string, unknown> })
			.dataModels;
		expect(actorModels.pc).toBeDefined();
	});

	test("registers a sheet for every table entry that has one", () => {
		const withSheet = [
			...Object.entries(SHEET_REGISTRY.Item),
			...Object.entries(SHEET_REGISTRY.Actor),
		].filter(([, entry]) => entry.sheet);
		expect(registeredSheets).toHaveLength(withSheet.length);
		for (const sheet of registeredSheets) {
			expect(sheet.makeDefault).toBe(true);
			expect(sheet.types).toHaveLength(1);
			expect(sheet.label).toBeTruthy();
		}
		// A model-only entry must NOT get a sheet registration.
		expect(
			registeredSheets.some((s) => s.types.includes("pc")),
		).toBe(false);
	});

	test("exposes the public roll API on game.rogueTrader", () => {
		const api = (
			globalThis as unknown as { game: { rogueTrader?: Record<string, unknown> } }
		).game.rogueTrader;
		for (const name of [
			"performRoll",
			"rollTest",
			"rollSkill",
			"rollSkillUntrained",
			"rollWeaponAttack",
			"rollPsychicPower",
			"rollNavigatorPower",
			"rollFearTest",
			"rollSnapOut",
		]) {
			expect(typeof api?.[name]).toBe("function");
		}
	});

	test("exposes the module extension points on CONFIG.ROGUE_TRADER", () => {
		const rtc = config.ROGUE_TRADER as Record<string, unknown>;
		expect(rtc.testContributors).toBeDefined();
		expect(rtc.talentEffectHandlers).toBeDefined();
		expect(
			typeof (rtc.homebrew as { getProfile?: unknown })?.getProfile,
		).toBe("function");
		expect(
			typeof (rtc.originTraits as { getDefs?: unknown })?.getDefs,
		).toBe("function");
		expect(typeof (rtc.madness as { getRows?: unknown })?.getRows).toBe(
			"function",
		);
	});

	test("registers the homebrew world setting", () => {
		expect(settings).toHaveLength(1);
		expect(settings[0].ns).toBe("rogue-trader");
	});

	test("registers the actor lifecycle hooks", () => {
		for (const name of ["preCreateActor", "preUpdateActor", "createActor"]) {
			expect(hooks.on.get(name)?.length ?? 0).toBeGreaterThan(0);
		}
	});

	test("registers the ready-time warmers", () => {
		// Six content caches + the legacy migration + the chat delegation.
		expect(hooks.once.get("ready")?.length ?? 0).toBeGreaterThanOrEqual(7);
	});

	test("homebrew getProfile degrades to core rules with no stored value", () => {
		const rtc = config.ROGUE_TRADER as {
			homebrew: { getProfile: () => { id?: string } };
		};
		// The stub returns "" (the setting default) -> NO_HOMEBREW, not a throw.
		expect(() => rtc.homebrew.getProfile()).not.toThrow();
	});
});

// --- Restore --------------------------------------------------------------

// Must be afterAll, not module scope: module-scope code runs before the tests,
// which would tear the stubs down before sheetInit() is ever called.
afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});
