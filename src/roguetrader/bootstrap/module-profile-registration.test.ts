/**
 * The module-profile registration seam at init (bead wxut.6).
 *
 * AC1: `bootstrap/config.ts` attaches `CONFIG.ROGUE_TRADER.registerRuleProfile`
 * beside the extension points that are already there, so a module can call it
 * from its own init hook. This is a wiring assertion, so it is made against the
 * RAN composition root rather than a source scan: the namespace is read back
 * after `registerSystemConfig()`, the register call is made the way a module
 * makes it, and the profile the rules then run on is checked end to end.
 *
 * Foundry is stubbed the same way bootstrap.test.ts stubs it (that file owns the
 * full composition-root coverage; this one only exercises the module seam).
 */

const globals = globalThis as Record<string, unknown>;
const saved = {
	CONFIG: globals.CONFIG,
	game: globals.game,
	foundry: globals.foundry,
	Handlebars: globals.Handlebars,
};

const config: Record<string, unknown> = {};
const settingsStore = new Map<string, unknown>();

globals.CONFIG = config;
globals.game = {
	system: { id: "rogue-trader" },
	i18n: { localize: (key: string) => key },
	settings: {
		register: () => undefined,
		registerMenu: () => undefined,
		get: (_ns: string, key: string) => settingsStore.get(key),
		set: (_ns: string, key: string, value: unknown) => {
			settingsStore.set(key, value);
			return Promise.resolve(value);
		},
	},
};
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { confirm: async () => false },
		},
		handlebars: {
			getTemplate: async () => () => "",
		},
	},
	utils: {},
};
globals.Handlebars = {
	registerHelper: () => undefined,
	registerPartial: () => undefined,
	helpers: {},
	partials: {},
};

const { registerSystemConfig } = await import("./config");
const {
	effectiveProfile,
	registeredModuleRuleProfiles,
	resetEffectiveProfileCacheForTests,
	resetModuleRuleProfilesForTests,
} = await import("../rules/homebrew");
const { rtCore } = await import("../../ffg/domain/system-profile");

import { afterAll, afterEach, expect, test } from "bun:test";
import type { ConfigPort } from "../../ffg/application/ports";

/** The namespace exactly as `bootstrap/config.ts` leaves it after one init. */
function registeredConfig(): Record<string, unknown> {
	registerSystemConfig();
	return config.ROGUE_TRADER as Record<string, unknown>;
}

afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

afterEach(() => {
	resetModuleRuleProfilesForTests();
	resetEffectiveProfileCacheForTests();
});

test("init attaches registerRuleProfile beside the other extension points", () => {
	const rtc = registeredConfig();
	// A module calls this from its own init hook.
	expect(typeof rtc.registerRuleProfile).toBe("function");
	// The READ half the rules app lists through: a function, not a snapshot,
	// because modules keep registering while the app is open.
	expect(typeof rtc.ruleProfiles).toBe("function");
	// The extension points that were already there are untouched.
	expect(rtc.testContributors).toBeDefined();
	expect(rtc.talentEffectHandlers).toBeDefined();
});

test("a module registers through the namespace and the rules run its delta", () => {
	const rtc = registeredConfig();
	const register = rtc.registerRuleProfile as (profile: unknown) => boolean;
	expect(
		register({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "test.critOnDouble": true, "criticals.maxSeverity": 8 },
		}),
	).toBe(true);
	// The provider reads the two settings through the config port; the world
	// has no stored profile, so the module layer is the whole house rule.
	// Bead x4ly: the ConfigPort double is bound as the seam's argument —
	// no `as unknown as Ports` cast, no setPorts global swap.
	const config: ConfigPort = {
		homebrew: () => null,
		profile: () => rtCore,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
	};
	const effective = effectiveProfile(config);
	expect(effective.critOnDouble).toBe(true);
	expect(effective.criticals?.maxSeverity).toBe(8);
	// The app's read half sees exactly what the seam merged.
	expect(
		(rtc.ruleProfiles as () => readonly { id: string }[])().map((p) => p.id),
	).toEqual(["lethal-crits"]);
});

test("a module's bad delta is refused at init and never reaches the rules", () => {
	const rtc = registeredConfig();
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map((arg) => String(arg)).join(" "));
	};
	let accepted: boolean;
	try {
		accepted = (rtc.registerRuleProfile as (profile: unknown) => boolean)({
			id: "typo",
			name: "Typo",
			delta: { "combat.fireModeBonus.semiAuto": 0 },
		});
	} finally {
		console.warn = original;
	}
	// Rejected LOUDLY (init must never throw, so the warning is the failure),
	// the knob named, and nothing registered.
	expect(accepted).toBe(false);
	expect(registeredModuleRuleProfiles()).toEqual([]);
	expect(warnings.join("\n")).toContain(
		'unknown rule knob "combat.fireModeBonus.semiAuto"',
	);
});
