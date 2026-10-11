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
 *
 * The same stubs double as the test bed for the rule-profile settings and the
 * retired-setting clear (bead wxut.3): the register calls are captured with the
 * data object they were given, and the settings surface is a backing store, so a
 * write can be observed.
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
	// Bead jpt3: core ships CONFIG.Combat.initiative.formula = null
	// (foundry.mjs:216831); the composition root overwrites it at init.
	Combat: { initiative: { formula: null } },
	statusEffects: [{ id: "core-thing" }],
};

const settings: Array<{
	ns: string;
	key: string;
	data: Record<string, unknown>;
}> = [];

/**
 * Bead wxut.4: every `game.settings.registerMenu` call. The rules app is
 * reached through a GM-restricted settings-menu button, so its registration
 * is asserted the same way the register() calls above are.
 */
const settingsMenus: Array<{
	ns: string;
	key: string;
	data: Record<string, unknown>;
}> = [];

/**
 * A bead-9if-shaped legacy profile: the object form the pre-profile setting
 * accepted, which bead wxut.2's knob-keyed delta deliberately does not.
 */
const LEGACY_HOMEBREW_JSON =
	'{"id":"house","fireModeBonus":{"burst":0,"full":10}}';

/**
 * A backing store for the settings surface, so reads see what was written.
 */
const settingsStore = new Map<string, unknown>();
const settingsWrites: Array<{ key: string; value: unknown }> = [];

// Bead wxut.3: seed the RETIRED legacy key so init's clear is observable —
// a world that upgraded with pre-profile house rules in it.
settingsStore.set("rogue-trader.homebrewProfile", LEGACY_HOMEBREW_JSON);

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
		// Bead wxut.4: the rules app opens from a GM-restricted settings-menu
		// button (the profile settings themselves are `config: false`), so its
		// registration is captured here exactly like the register() calls above.
		registerMenu: (ns: string, key: string, data: object) => {
			settingsMenus.push({ ns, key, data: data as Record<string, unknown> });
		},
		register: (ns: string, key: string, data: object) => {
			settings.push({ ns, key, data: data as Record<string, unknown> });
		},
		get: (ns: string, key: string) => settingsStore.get(`${ns}.${key}`),
		set: (ns: string, key: string, value: unknown) => {
			settingsWrites.push({ key, value });
			settingsStore.set(`${ns}.${key}`, value);
			return Promise.resolve(value);
		},
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
globals.ui = {
	notifications: { warn: () => undefined, info: () => undefined },
};
globals.Handlebars = {
	registerHelper: () => undefined,
	registerPartial: () => undefined,
	helpers: {},
	partials: {},
};

const { sheetInit } = await import("./index");
const {
	clearLegacyHomebrewSetting,
	activeProfileDeltaFromSettings,
	registerRulesAppMenu,
} = await import("./config");
const { SHEET_REGISTRY } = await import("./sheet-registry");

// --- Helpers --------------------------------------------------------------

/** Fire every callback registered for a hook. */
function fire(name: string, ...args: unknown[]): void {
	for (const fn of hooks.once.get(name) ?? []) fn(...(args as never[]));
	for (const fn of hooks.on.get(name) ?? []) fn(...(args as never[]));
}

interface SettingsHarness {
	/** What `get` answers with, after any writes. */
	store: Map<string, unknown>;
	/** One entry per `set` call, in order. */
	writes: Array<{ key: string; value: unknown }>;
	/** The surface, keyed exactly the way the seam keys it. */
	surface: {
		get(ns: string, key: string): unknown;
		set(ns: string, key: string, value: unknown): Promise<unknown>;
	};
}

/**
 * A settings double for the rule-profile seam (bead wxut.3): a backing store,
 * a write log, and a surface that speaks the same (ns, key) shape.
 */
function fakeSettingsSurface(
	initial: Record<string, unknown> = {},
): SettingsHarness {
	const store = new Map<string, unknown>(Object.entries(initial));
	const writes: Array<{ key: string; value: unknown }> = [];
	return {
		store,
		writes,
		surface: {
			get: (_ns: string, key: string) => store.get(key),
			set: (_ns: string, key: string, value: unknown) => {
				writes.push({ key, value });
				store.set(key, value);
				return Promise.resolve(value);
			},
		},
	};
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

	// Bead jpt3: the tracker's own Roll Initiative button reads the default
	// formula from CONFIG.Combat.initiative.formula (core's fallback at
	// foundry.mjs:59939-59941) — the init wiring must set it, in the shared
	// placeholder shape (1d10 + the roll-data @initiativeBonus getter).
	// Read from the EXISTING config object right after this file's single
	// init firing — the sheet-registration tests below are order-sensitive
	// (they assert exact totals), so no second fire is issued here.
	test("sets CONFIG.Combat.initiative.formula at init", () => {
		const formula = (config.Combat as { initiative: { formula: string } })
			.initiative.formula;
		expect(formula).toContain("1d10");
		expect(formula).toContain("@initiativeBonus");
	});

	test("replaces the core status list with the system statuses (p0af)", () => {
		const statuses = config.statusEffects as Array<{
			id: string;
			name: string;
			img: string;
			statuses: string[];
			changes?: Array<{ key: string; mode: number; value: number }>;
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

	test("penalised statuses carry the testModifier change so HUD applies hit the funnel (c9nt)", () => {
		const statuses = config.statusEffects as Array<{
			id: string;
			changes?: Array<{ key: string; mode: number; value: number }>;
		}>;
		const byId = new Map(statuses.map((s) => [s.id, s]));
		// Book penalties ride the config: Foundry copies it onto the AE the
		// HUD toggle creates, so the funnel's "effect" contributor sees it.
		expect(byId.get("prone")?.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -10 },
		]);
		expect(byId.get("pinned")?.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -20 },
		]);
		expect(byId.get("blinded")?.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -30 },
		]);
		// No-penalty statuses carry no changes key.
		expect(byId.get("startled")?.changes).toBeUndefined();
		expect(byId.get("grappled")?.changes).toBeUndefined();
	});

	test("registers every SHEET_REGISTRY type as a data model", () => {
		// Table-driven on purpose: a new type cannot silently skip registration.
		const itemModels = (config.Item as { dataModels: Record<string, unknown> })
			.dataModels;
		const actorModels = (
			config.Actor as { dataModels: Record<string, unknown> }
		).dataModels;
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
		const actorModels = (
			config.Actor as { dataModels: Record<string, unknown> }
		).dataModels;
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
		expect(registeredSheets.some((s) => s.types.includes("pc"))).toBe(false);
	});

	test("exposes the public roll API on game.rogueTrader", () => {
		const api = (
			globalThis as unknown as {
				game: { rogueTrader?: Record<string, unknown> };
			}
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
			"rollToxicToughnessTest",
		]) {
			expect(typeof api?.[name]).toBe("function");
		}
	});

	test("exposes the module extension points on CONFIG.ROGUE_TRADER", () => {
		const rtc = config.ROGUE_TRADER as Record<string, unknown>;
		expect(rtc.testContributors).toBeDefined();
		expect(rtc.talentEffectHandlers).toBeDefined();
		expect(typeof (rtc.homebrew as { getProfile?: unknown })?.getProfile).toBe(
			"function",
		);
		expect(typeof (rtc.originTraits as { getDefs?: unknown })?.getDefs).toBe(
			"function",
		);
		expect(typeof (rtc.madness as { getRows?: unknown })?.getRows).toBe(
			"function",
		);
	});

	test("registers the three rule-profile settings", () => {
		// Bead wxut.3: the retired legacy key plus the two rule-profile keys.
		// The tracker's `core.combatTrackerConfig` re-registration happens on
		// "ready", not "init", so it is not counted here.
		expect(settings.map((s) => s.key)).toEqual([
			"homebrewProfile",
			"ruleProfiles",
			"activeProfileId",
		]);
		for (const entry of settings) {
			expect(entry.ns).toBe("rogue-trader");
			// All three are edited by the rules app (bead wxut.4), never on the
			// native settings form: no config entry.
			expect(entry.data.scope).toBe("world");
			expect(entry.data.config).toBe(false);
			expect(entry.data.type).toBe(String);
			expect(entry.data.default).toBe("");
			// The bead-9if label/hint keys are gone with the form entry.
			expect(entry.data.name).toBeUndefined();
			expect(entry.data.hint).toBeUndefined();
		}
	});

	test("registers a GM-only menu button for the rules app (bead wxut.4)", () => {
		// The profile settings are `config: false`, so the app is reached through
		// a registerMenu button — and only a GM may open it.
		const menu = settingsMenus.find((m) => m.key === "rulesProfiles");
		expect(menu).toBeDefined();
		expect(menu?.ns).toBe("rogue-trader");
		expect(menu?.data.restricted).toBe(true);
		expect(menu?.data.icon).toBe("fa-solid fa-sliders");
		// Foundry instantiates this class with no arguments when the button is
		// clicked; the app must therefore be a zero-argument constructor.
		const appType = menu?.data.type as (new () => unknown) | undefined;
		expect(typeof appType).toBe("function");
		expect(appType?.name).toBe("RulesApp");
		// The menu's own chrome resolves through i18n. `game.i18n` is absent from
		// this harness, so the KEY is what reaches the register call — which is
		// what the i18n key-parity guard then checks against lang/*.json.
		for (const field of ["name", "label", "hint"]) {
			expect(String(menu?.data[field])).toMatch(/^RULES\./);
		}
	});

	test("the rules-app menu survives an absent or hostile settings surface", () => {
		// No surface at all (a stripped harness): nothing to register, no throw.
		expect(() => registerRulesAppMenu(undefined)).not.toThrow();
		// A surface that refuses the registration: init must not break over a
		// missing button (bead wxut.4).
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			expect(() =>
				registerRulesAppMenu({
					get: () => undefined,
					set: () => Promise.resolve(),
					registerMenu: () => {
						throw new Error("already registered");
					},
				}),
			).not.toThrow();
		} finally {
			console.warn = original;
		}
		expect(warnings).toHaveLength(1);
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
			homebrew: { getProfile: () => unknown };
		};
		// Nothing configured: no stored profiles and no active id -> null, which
		// the seam reads as CORE RULES (bead wxut.2's base-profile identity).
		expect(rtc.homebrew.getProfile()).toBeNull();
	});
});

// --- Rule-profile settings and the legacy clear (bead wxut.3) ---------------

describe("rule-profile settings and provider (bead wxut.3)", () => {
	test("init CLEARS the retired legacy setting (owner ruling, no migration)", () => {
		// Seeded at module scope above, so init's clear has something to do.
		expect(settingsStore.get("rogue-trader.homebrewProfile")).toBe("");
		const write = settingsWrites.find((w) => w.key === "homebrewProfile");
		expect(write?.value).toBe("");
		// Not migrated: nothing is written to either rule-profile key.
		expect(settingsWrites.map((w) => w.key)).toEqual(["homebrewProfile"]);
		expect(settingsStore.get("rogue-trader.ruleProfiles")).toBeUndefined();
		expect(settingsStore.get("rogue-trader.activeProfileId")).toBeUndefined();
	});

	test("the legacy clear leaves an empty setting alone", () => {
		for (const initial of ["", null, undefined]) {
			const harness = fakeSettingsSurface({
				homebrewProfile: initial,
			});
			clearLegacyHomebrewSetting(harness.surface);
			expect(harness.writes).toEqual([]);
			expect(harness.store.get("homebrewProfile")).toBe(initial);
		}
	});

	test("the legacy clear never breaks init, even when the write rejects", async () => {
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			const surface = {
				get: () => '{"id":"house"}',
				set: () => Promise.reject(new Error("world is read-only")),
			};
			expect(() => clearLegacyHomebrewSetting(surface)).not.toThrow();
			// The rejection is reported on a microtask, so let it land.
			await Promise.resolve();
			await Promise.resolve();
			const throwing = {
				get: () => {
					throw new Error("settings are gone");
				},
				set: () => undefined,
			};
			expect(() => clearLegacyHomebrewSetting(throwing)).not.toThrow();
			expect(() => clearLegacyHomebrewSetting(undefined)).not.toThrow();
		} finally {
			console.warn = original;
		}
		// One warn for the rejected write, one for the throwing read.
		expect(warnings).toHaveLength(2);
	});

	test("the provider hands back the ACTIVE profile's delta, unmerged", () => {
		const profiles = JSON.stringify([
			{
				id: "berners",
				name: "Burst-friendly",
				delta: { "combat.fireModeBonus.burst": 0 },
			},
			{
				id: "strict",
				name: "Strict ammo",
				delta: { "ammo.autoConsume": true },
			},
		]);
		const surface = fakeSettingsSurface({
			ruleProfiles: profiles,
			activeProfileId: "strict",
		}).surface;
		// LOOKUP ONLY: the raw knob-keyed delta of the named profile, with no
		// base-profile fields merged in (the seam does the merging).
		expect(activeProfileDeltaFromSettings(surface)).toEqual({
			"ammo.autoConsume": true,
		});
	});

	test("an unknown, absent or blank activeProfileId means core rules", () => {
		const profiles = JSON.stringify([
			{ id: "berners", name: "B", delta: { "ammo.autoConsume": true } },
		]);
		for (const activeProfileId of ["", "   ", "nope", null, undefined, 7]) {
			const surface = fakeSettingsSurface({
				ruleProfiles: profiles,
				activeProfileId,
			}).surface;
			expect(activeProfileDeltaFromSettings(surface)).toBeNull();
		}
		// No profiles stored at all, with an id that names nothing.
		expect(
			activeProfileDeltaFromSettings(fakeSettingsSurface({}).surface),
		).toBeNull();
	});

	test("an unparseable or empty profile list means core rules", () => {
		for (const ruleProfiles of [
			"not json",
			'{"id":"berners"}',
			"[]",
			"{}",
			null,
			undefined,
			42,
		]) {
			const surface = fakeSettingsSurface({
				ruleProfiles,
				activeProfileId: "berners",
			}).surface;
			expect(activeProfileDeltaFromSettings(surface)).toBeNull();
		}
	});

	test("a profile whose delta is empty is the same as no profile", () => {
		const surface = fakeSettingsSurface({
			ruleProfiles: JSON.stringify([{ id: "berners", name: "B", delta: {} }]),
			activeProfileId: "berners",
		}).surface;
		expect(activeProfileDeltaFromSettings(surface)).toBeNull();
	});

	test("a malformed profile row is skipped rather than activated", () => {
		const surface = fakeSettingsSurface({
			// No delta, a non-string id, a nested array: none of these is a row.
			ruleProfiles: JSON.stringify([
				{ id: "berners", name: "B" },
				{ id: 42, name: "B", delta: { "ammo.autoConsume": true } },
				["berners", { "ammo.autoConsume": true }],
			]),
			activeProfileId: "berners",
		}).surface;
		expect(activeProfileDeltaFromSettings(surface)).toBeNull();
	});

	test("getProfile degrades to null when the settings surface is absent", () => {
		// The pre-init window (or a stripped test harness): never a throw.
		expect(activeProfileDeltaFromSettings(undefined)).toBeNull();
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			const broken = {
				get: () => {
					throw new Error("no settings database");
				},
			};
			// One read, so the warning count is the seam's own.
			let read: unknown = "unset";
			expect(() => {
				read = activeProfileDeltaFromSettings(broken);
			}).not.toThrow();
			expect(read).toBeNull();
		} finally {
			console.warn = original;
		}
		expect(warnings).toHaveLength(1);
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
