/**
 * TestDialog house-rule indicator (epic wxut, child B7).
 *
 * The indicator is the one place a roll's numbers are attributed to the
 * house-rule profile behind them (AGENTS.md: silent modifiers are bugs), so it
 * is tested as PURE logic: what the two settings say, how many knobs the
 * active profile really overrides, and which localised key the header takes.
 * The Foundry-coupled edges beside it (the settings read and the rules-app
 * opener) are covered at the end with the same global-stub pattern the other
 * roll-pipeline suites use.
 */

// --- Foundry/global stubs (must precede the dynamic import) ---------------
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
/** The stub world the settings edge swaps per test. */
const stubGame = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, vars?: Record<string, unknown>) =>
			`${key}:${vars?.name ?? ""}:${vars?.count ?? ""}`,
	},
	system: { id: "rogue-trader" },
	user: { isGM: true },
	settings: { get: () => "" },
};
(globalThis as Record<string, unknown>).game = stubGame;
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
};

const {
	activeTestDialogProfileIndicator,
	openRulesApp,
	testDialogProfileIndicator,
} = await import("./test-dialog");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
} from "../../../ffg/domain/rule-knobs";

/** A recording `format` seam: what the builder asked for, and what it got. */
function recordingFormat(): {
	format: (key: string, vars?: Record<string, unknown>) => string;
	calls: Array<{ key: string; vars?: Record<string, unknown> }>;
} {
	const calls: Array<{ key: string; vars?: Record<string, unknown> }> = [];
	return {
		calls,
		format: (key, vars) => {
			calls.push({ key, vars });
			return `${key}(${vars?.name ?? ""}/${vars?.count ?? ""})`;
		},
	};
}

/** A stored profile row, as the setting holds it. */
const row = (
	id: string,
	name: string,
	delta: Record<string, unknown>,
): string => JSON.stringify([{ id, name, delta }]);

/** Two overridden knobs (both differ from their Core Rulebook values). */
const TWO_OVERRIDES = {
	"combat.fireModeBonus.burst": 15,
	"psychic.pushCap.sanctioned": 5,
};

describe("testDialogProfileIndicator (bead wxut.7)", () => {
	it("shows NOTHING when core rules are active", () => {
		const { format } = recordingFormat();
		expect(testDialogProfileIndicator("[]", "", format)).toBeNull();
		expect(
			testDialogProfileIndicator(
				JSON.stringify([{ id: "lethal", name: "Lethal", delta: {} }]),
				"",
				format,
			),
		).toBeNull();
	});

	it("shows NOTHING for an unparseable or non-list setting", () => {
		const { format } = recordingFormat();
		expect(testDialogProfileIndicator("not json", "lethal", format)).toBeNull();
		expect(
			testDialogProfileIndicator('{"id":"x"}', "lethal", format),
		).toBeNull();
		expect(testDialogProfileIndicator(null, "lethal", format)).toBeNull();
	});

	it("shows NOTHING when the active id names no row (a stale id)", () => {
		const { format } = recordingFormat();
		expect(
			testDialogProfileIndicator(
				row("lethal", "Lethal", TWO_OVERRIDES),
				"unknown",
				format,
			),
		).toBeNull();
	});

	it("shows NOTHING for a profile that overrides nothing", () => {
		// The app's rule 1: an untouched profile stores an empty delta, so it
		// IS core rules and must not add noise to the header.
		const { format } = recordingFormat();
		expect(
			testDialogProfileIndicator(
				row("touch", "Untouched", {}),
				"touch",
				format,
			),
		).toBeNull();
	});

	it("shows NOTHING when the only delta keys are unknown knobs", () => {
		// Unknown keys are warned about and ignored by the seam, so core rules
		// keep running — the header must not claim otherwise.
		const { format } = recordingFormat();
		expect(
			testDialogProfileIndicator(
				row("typo", "Typo", { "nonsense.knob": 5 }),
				"typo",
				format,
			),
		).toBeNull();
	});

	it("shows NOTHING when every knob is stored at its core value", () => {
		// Semi-Auto Burst is +10 in the Core Rulebook (p237).
		const { format } = recordingFormat();
		expect(
			testDialogProfileIndicator(
				row("core", "Core copy", { "combat.fireModeBonus.burst": 10 }),
				"core",
				format,
			),
		).toBeNull();
	});

	it("names the profile and counts its overrides", () => {
		const { format, calls } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("lethal", "Lethal", TWO_OVERRIDES),
			"lethal",
			format,
		);
		expect(indicator).not.toBeNull();
		expect(indicator?.name).toBe("Lethal");
		expect(indicator?.overrideCount).toBe(2);
		expect(indicator?.label).toBe("ROLL.HOUSE_RULES(Lethal/2)");
		expect(indicator?.hint).toBe("ROLL.HOUSE_RULES_HINT(/)");
		expect(calls.map((call) => call.key)).toEqual([
			"ROLL.HOUSE_RULES",
			"ROLL.HOUSE_RULES_HINT",
		]);
	});

	it("uses the singular key for exactly one override", () => {
		const { format, calls } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("one", "One Knob", { "combat.fireModeBonus.burst": 15 }),
			"one",
			format,
		);
		expect(indicator?.overrideCount).toBe(1);
		expect(indicator?.label).toBe("ROLL.HOUSE_RULES_ONE(One Knob/1)");
		expect(calls[0]?.key).toBe("ROLL.HOUSE_RULES_ONE");
	});

	it("counts only the overrides in force, not every delta key", () => {
		// One real override beside a typo'd key and a core-valued knob.
		const { format } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("mixed", "Mixed", {
				"combat.fireModeBonus.burst": 15,
				"nonsense.knob": 5,
				"psychic.pushCap.sanctioned": 3,
			}),
			"mixed",
			format,
		);
		expect(indicator?.overrideCount).toBe(1);
	});

	it("falls back to the profile id when a row has no name", () => {
		const { format } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("nameless", "", TWO_OVERRIDES),
			"nameless",
			format,
		);
		expect(indicator?.name).toBe("nameless");
	});

	it("reads the ACTIVE row, not the first one", () => {
		const { format } = recordingFormat();
		const stored = JSON.stringify([
			{ id: "first", name: "First", delta: { "test.critOnDouble": false } },
			{ id: "second", name: "Second", delta: TWO_OVERRIDES },
		]);
		expect(testDialogProfileIndicator(stored, "second", format)?.name).toBe(
			"Second",
		);
		expect(
			testDialogProfileIndicator(stored, "first", format)?.overrideCount,
		).toBe(1);
	});

	it("is localised in all four shipped languages", () => {
		const keys = [
			"ROLL.HOUSE_RULES",
			"ROLL.HOUSE_RULES_ONE",
			"ROLL.HOUSE_RULES_HINT",
		];
		for (const lang of ["en", "es", "fr", "pl"]) {
			const strings = JSON.parse(
				readFileSync(`lang/${lang}.json`, "utf8"),
			) as Record<string, string>;
			for (const key of keys) {
				expect(strings[key], `${lang} has ${key}`).toBeTruthy();
			}
			// The composed sentences carry the placeholders the builder fills.
			expect(strings["ROLL.HOUSE_RULES"]).toContain("{name}");
			expect(strings["ROLL.HOUSE_RULES"]).toContain("{count}");
			expect(strings["ROLL.HOUSE_RULES_ONE"]).toContain("{name}");
		}
	});
});

describe("the TestDialog settings edge (bead wxut.7)", () => {
	it("reads the two rule-profile settings through the system namespace", () => {
		const requested: Array<[string, string]> = [];
		(globalThis as Record<string, unknown>).game = {
			...stubGame,
			settings: {
				get: (ns: string, key: string) => {
					requested.push([ns, key]);
					if (key === "ruleProfiles")
						return row("lethal", "Lethal", TWO_OVERRIDES);
					return "lethal";
				},
			},
		};
		try {
			const indicator = activeTestDialogProfileIndicator();
			expect(indicator?.name).toBe("Lethal");
			expect(indicator?.overrideCount).toBe(2);
			// Localised through the i18n port's format seam.
			expect(indicator?.label).toBe("ROLL.HOUSE_RULES:Lethal:2");
			expect(requested).toEqual([
				["rogue-trader", "ruleProfiles"],
				["rogue-trader", "activeProfileId"],
			]);
		} finally {
			(globalThis as Record<string, unknown>).game = stubGame;
		}
	});

	it("names a MODULE profile in force (bead wxut.6 seam)", () => {
		// A module-registered profile is not in `ruleProfiles`, so without the
		// module layer `stateFromSettings` resolves `activeId` to "" (core) and
		// the indicator would vanish while that module's rules were running — a
		// silent modifier.
		(globalThis as Record<string, unknown>).game = {
			...stubGame,
			settings: {
				get: (_ns: string, key: string) =>
					key === "ruleProfiles" ? "" : "grim-mod",
			},
		};
		(globalThis as Record<string, unknown>).CONFIG = {
			ROGUE_TRADER: {
				ruleProfiles: () => [
					{
						id: "grim-mod",
						name: "Grim Module",
						delta: { "combat.fireModeBonus.burst": 0 },
					},
				],
			},
		};
		try {
			const indicator = activeTestDialogProfileIndicator();
			expect(indicator?.name).toBe("Grim Module");
			expect(indicator?.overrideCount).toBe(1);
		} finally {
			delete (globalThis as Record<string, unknown>).CONFIG;
			(globalThis as Record<string, unknown>).game = stubGame;
		}
	});

	it("degrades to no indicator when a setting read throws", () => {
		(globalThis as Record<string, unknown>).game = {
			i18n: { localize: (key: string) => key, format: (key: string) => key },
			system: { id: "rogue-trader" },
			settings: {
				get: () => {
					throw new Error("settings not ready");
				},
			},
		};
		try {
			expect(activeTestDialogProfileIndicator()).toBeNull();
		} finally {
			(globalThis as Record<string, unknown>).game = stubGame;
		}
	});

	it("opens the rules app on the click-through", async () => {
		// Patched on the prototype so the assertion does not depend on which
		// suite's ApplicationV2 stub was global when the class was defined
		// (bun runs every suite in one process).
		const { RulesApp } = await import("../rules-app");
		const hadOwn = Object.hasOwn(RulesApp.prototype, "render");
		const original = RulesApp.prototype.render;
		const renders: unknown[] = [];
		RulesApp.prototype.render = function render(
			this: unknown,
			force?: boolean,
		) {
			renders.push(force);
			return Promise.resolve(this);
		} as unknown as typeof RulesApp.prototype.render;
		try {
			await openRulesApp();
			expect(renders).toEqual([true]);
		} finally {
			if (hadOwn) RulesApp.prototype.render = original;
			else delete (RulesApp.prototype as { render?: unknown }).render;
		}
	});

	it("opens nothing for a player (the app is world configuration)", async () => {
		const { RulesApp } = await import("../rules-app");
		const hadOwn = Object.hasOwn(RulesApp.prototype, "render");
		const original = RulesApp.prototype.render;
		const renders: unknown[] = [];
		RulesApp.prototype.render = function render(
			this: unknown,
			force?: boolean,
		) {
			renders.push(force);
			return Promise.resolve(this);
		} as unknown as typeof RulesApp.prototype.render;
		(globalThis as Record<string, unknown>).game = {
			...stubGame,
			user: { isGM: false },
		};
		try {
			await openRulesApp();
			expect(renders).toEqual([]);
		} finally {
			if (hadOwn) RulesApp.prototype.render = original;
			else delete (RulesApp.prototype as { render?: unknown }).render;
			(globalThis as Record<string, unknown>).game = stubGame;
		}
	});
});

// ---------------------------------------------------------------------------
// Whose registry? (bead w9sa.2)
// ---------------------------------------------------------------------------

/**
 * A FAKE sibling registry, in the shape bead w9sa.3 authors DH2's for real.
 * Nothing in it matches an RT knob key, so an override count that still reads
 * Rogue Trader's knobs cannot pass by accident.
 */
const SIBLING_KNOBS = [
	{
		key: "combat.standardMode",
		path: ["fireModeBonus", "burst"],
		labelKey: "RULES.COMBAT_STANDARD_MODE",
		hintKey: "RULES.COMBAT_STANDARD_MODE_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 10,
	},
] as const;
const SIBLING_REGISTRY = {
	systemId: "dark-heresy-2e",
	knobs: SIBLING_KNOBS,
};

afterEach(() => {
	resetRuleKnobRegistryForTests();
});

describe("the indicator counts the OVERRIDES OF THE RULES IN FORCE", () => {
	it("counts RT's knobs with nothing registered", () => {
		const { format } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("lethal", "Lethal", TWO_OVERRIDES),
			"lethal",
			format,
		);
		expect(indicator?.overrideCount).toBe(2);
	});

	it("counts the SIBLING's knobs once IT is the registry in force", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		const { format } = recordingFormat();
		const indicator = testDialogProfileIndicator(
			row("standard", "Standard", { "combat.standardMode": -10 }),
			"standard",
			format,
		);
		expect(indicator?.overrideCount).toBe(1);
		expect(indicator?.name).toBe("Standard");
	});

	it("shows NOTHING for a delta keyed to Rogue Trader's knobs", () => {
		// The roll dialog must never claim a house rule the running system does
		// not have: with the sibling registry in force those keys describe no
		// rule, so the indicator stays absent (core rules are running).
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		const { format } = recordingFormat();
		expect(
			testDialogProfileIndicator(
				row("lethal", "Lethal", TWO_OVERRIDES),
				"lethal",
				format,
			),
		).toBeNull();
	});
});
