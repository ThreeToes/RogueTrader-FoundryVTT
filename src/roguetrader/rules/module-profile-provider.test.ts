/**
 * Module-registered profiles in the effective-profile seam (bead wxut.6).
 *
 * Sharing tier T2: a module calls `CONFIG.ROGUE_TRADER.registerRuleProfile` at
 * its own init, and the rules run with that module's delta layered in. This is
 * the PROVIDER-OVERRIDE test in the style of
 * infrastructure/foundry/profile-port.test.ts: the config port is swapped so
 * the seam reads a given world state, a module profile is registered, and
 * `effectiveProfile()` is asked what the rules would run on.
 *
 * The contract pinned here:
 *   - provider order is rtCore -> module profiles -> active world profile, in
 *     ONE merge hop (epic wxut architecture) — so a module delta never
 *     inherits a world-profile value: module first, WORLD wins;
 *   - a module ships a DELTA, so a registry-excluded field (system identity,
 *     a sibling-system extension point) cannot be pinned by a registration;
 *   - a registration that fails `validateProfile` is REJECTED LOUDLY at init,
 *     naming the knob, and never registered — not silently dropped;
 *   - registration is idempotent by id: a re-registration replaces;
 *   - activating a module profile puts ITS rules in force, and that is the only
 *     thing the world stores (`activeProfileId`) — the module's delta never
 *     becomes world data.
 *
 * The Foundry globals are stubbed before the dynamic import because the ports
 * module touches the Foundry implementation set at load (the same reason
 * profile-port.test.ts does it).
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {};

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Ports } from "../../ffg/application/ports";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

/** The module layer and the seam's memo are process-global: neither may leak. */
afterEach(() => {
	resetModuleRuleProfilesForTests();
	resetEffectiveProfileCacheForTests();
	resetPorts();
});

const {
	activeProfileDelta,
	effectiveProfile,
	registerModuleRuleProfile,
	registeredModuleRuleProfiles,
	resetEffectiveProfileCacheForTests,
	resetModuleRuleProfilesForTests,
} = await import("./homebrew");
const { rtCore } = await import("../../ffg/domain/system-profile");
const { resetPorts, setPorts } = await import(
	"../../ffg/infrastructure/foundry/ports"
);

/** A world whose stored profiles are `rows`, with `activeId` in force. */
function worldWith(
	rows: readonly { id: string; name: string; delta: Record<string, unknown> }[],
	activeId: string,
): void {
	const stored = JSON.stringify(rows);
	const stub = {
		config: {
			// The provider in bootstrap/config.ts does exactly this lookup: the
			// ACTIVE profile's delta, or null for core rules.
			homebrew: () => activeProfileDelta(stored, activeId),
			profile: () => rtCore,
			originTraits: () => [],
			packIds: () => ({ rolltables: null }),
		},
	} as unknown as Ports;
	setPorts(stub);
}

/** A world with one named profile in force. */
function worldProfileInForce(
	id: string,
	delta: Record<string, unknown>,
): void {
	worldWith([{ id, name: id, delta }], id);
}

/** Capture console.warn for the duration of one call (the LOUD rejection). */
function captureWarnings(run: () => void): string[] {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map((arg) => String(arg)).join(" "));
	};
	try {
		run();
	} finally {
		console.warn = original;
	}
	return warnings;
}

describe("module profiles in the effective profile (bead wxut.6)", () => {
	test("a registered module profile is the profile in force when it is ACTIVE", () => {
		// A "lethal crits" module: crits on doubles, exactly the owner's
		// motivating example for a module-shippable house rule.
		expect(
			registerModuleRuleProfile({
				id: "lethal-crits",
				name: "Lethal crits",
				delta: { "test.critOnDouble": true, "criticals.maxSeverity": 8 },
			}),
		).toBe(true);
		worldWith([], "lethal-crits");
		const effective = effectiveProfile();
		expect(effective.critOnDouble).toBe(true);
		expect(effective.criticals?.maxSeverity).toBe(8);
		// Everything the module did not say stays at the Core Rulebook value.
		expect(effective.fireModeBonus).toEqual(rtCore.fireModeBonus);
	});

	test("the WORLD wins a knob both a module and a world profile set", () => {
		registerModuleRuleProfile({
			id: "silly-burst",
			name: "Silly burst",
			delta: { "combat.fireModeBonus.burst": 0 },
		});
		// The GM's own profile sets the SAME knob, and is active.
		worldProfileInForce("mine", { "combat.fireModeBonus.burst": 15 });
		const effective = effectiveProfile();
		expect(effective.fireModeBonus).toEqual({ burst: 15, full: 20 });
		// The base profile was never either of them.
		expect(rtCore.fireModeBonus).toEqual({ burst: 10, full: 20 });
	});

	test("a module delta does NOT inherit world-profile values (one merge hop)", () => {
		// Both sides write DIFFERENT knobs: the effective profile is the base
		// with both merged over it, so a module never sees the GM's values and
		// the GM never loses theirs to a module.
		registerModuleRuleProfile({
			id: "auto-consume",
			name: "Auto consume",
			delta: { "ammo.autoConsume": true },
		});
		worldProfileInForce("mine", { "test.critOnDouble": false });
		const effective = effectiveProfile();
		expect(effective.ammoAutoConsume).toBe(true);
		expect(effective.critOnDouble).toBe(false);
	});

	test("a WHOLE-CONTAINER knob is replaced, never band-merged across layers", () => {
		// The hit-location table is a whole-replacement knob: with both a module
		// and a world profile carrying one, the WORLD's table is the answer —
		// not a union of bands from two different books.
		const moduleTable = { "86-00": "head", "85-71": "rightArm" };
		const worldTable = { "86-00": "head", "85-71": "leftArm" };
		registerModuleRuleProfile({
			id: "alt-hits",
			name: "Alt hits",
			delta: { "tables.hitLocations": moduleTable },
		});
		worldProfileInForce("mine", { "tables.hitLocations": worldTable });
		expect(effectiveProfile().hitLocations).toEqual(worldTable);
	});

	test("the module layer survives a BROKEN world profile (it drops only itself)", () => {
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "criticals.maxSeverity": 8 },
		});
		// The stored profile is the retired bead-9if object shape: the registry
		// refuses it by name and the WORLD's house rules are ignored...
		const warnings = captureWarnings(() => {
			worldWith([], "");
			setPorts({
				config: {
					homebrew: () => ({ id: "house", fireModeBonus: { burst: 0 } }),
					profile: () => rtCore,
					originTraits: () => [],
					packIds: () => ({ rolltables: null }),
				},
			} as unknown as Ports);
			expect(effectiveProfile().criticals?.maxSeverity).toBe(8);
		});
		// ...but the module's rules still run, and the refusal was reported.
		expect(warnings.join("\n")).toContain("ignoring house-rule profile");
	});

	test("with nothing registered and nothing stored the base profile is returned AS IS", () => {
		worldWith([], "");
		// Identity, not just equality: sibling-module swaps and tests rely on it.
		expect(effectiveProfile()).toBe(rtCore);
	});

	test("a module that registers nothing leaves core rules alone", () => {
		// An empty delta is a valid registration that says nothing: the seam's
		// identity guarantee still holds.
		registerModuleRuleProfile({ id: "quiet", name: "Quiet", delta: {} });
		worldWith([], "");
		expect(effectiveProfile()).toBe(rtCore);
	});

	test("registering AFTER a roll was memoised changes the next roll (qa9k cache)", () => {
		worldWith([], "");
		expect(effectiveProfile()).toBe(rtCore);
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "criticals.maxSeverity": 8 },
		});
		// No cache reset and no Foundry hook: the registry's own version is part
		// of the memo key, so the module's init is honoured immediately.
		expect(effectiveProfile().criticals?.maxSeverity).toBe(8);
	});
});

describe("registerModuleRuleProfile — loud rejection, idempotence (bead wxut.6)", () => {
	test("an UNKNOWN knob is rejected, NAMED, and never registered", () => {
		const warnings = captureWarnings(() => {
			expect(
				registerModuleRuleProfile({
					id: "typo",
					name: "Typo",
					delta: { "combat.fireModeBonus.semiAuto": 0 },
				}),
			).toBe(false);
		});
		expect(registeredModuleRuleProfiles()).toEqual([]);
		expect(warnings).toHaveLength(1);
		// The KNOB is in the sentence, not just the profile: a module author
		// (and the GM reading the console) is told exactly what to fix.
		expect(warnings[0]).toContain('rule profile "typo" rejected');
		expect(warnings[0]).toContain('unknown rule knob "combat.fireModeBonus.semiAuto"');
	});

	test("a WRONG-TYPED knob is rejected and named", () => {
		const warnings = captureWarnings(() => {
			expect(
				registerModuleRuleProfile({
					id: "typo",
					name: "Typo",
					delta: { "ammo.autoConsume": "yes please" },
				}),
			).toBe(false);
		});
		expect(registeredModuleRuleProfiles()).toEqual([]);
		expect(warnings[0]).toContain('"ammo.autoConsume" expects a boolean');
	});

	test("a bad SHAPE is rejected and named (no id, no name, no delta object)", () => {
		const warnings = captureWarnings(() => {
			registerModuleRuleProfile(undefined);
			registerModuleRuleProfile({ name: "no id", delta: {} });
			registerModuleRuleProfile({ id: "x", name: "  ", delta: {} });
			registerModuleRuleProfile({ id: "x", name: "X", delta: "nope" });
			registerModuleRuleProfile([{ id: "x", name: "X", delta: {} }]);
		});
		expect(registeredModuleRuleProfiles()).toEqual([]);
		expect(warnings).toHaveLength(5);
		expect(warnings[0]).toContain("a rule profile must be an object");
		expect(warnings[1]).toContain("needs a non-empty string id");
		expect(warnings[2]).toContain('rule profile "x" needs a non-empty string name');
		expect(warnings[3]).toContain('rule profile "x" needs a delta object');
	});

	test("a module CANNOT pin a core value: registry-excluded fields are refused", () => {
		// A profile is a DELTA of GM-tunable rules. System identity and the
		// sibling-system extension points are not knobs (RULE_KNOBS_EXCLUDED_KEYS),
		// so a module cannot ship a snapshot of them.
		const warnings = captureWarnings(() => {
			registerModuleRuleProfile({
				id: "frozen",
				name: "Frozen",
				delta: { messageFlagNamespace: "rogue-trader" },
			});
			registerModuleRuleProfile({
				id: "frozen-2",
				name: "Frozen 2",
				delta: { criticalTables: {} },
			});
		});
		expect(registeredModuleRuleProfiles()).toEqual([]);
		expect(warnings[0]).toContain('unknown rule knob "messageFlagNamespace"');
		expect(warnings[1]).toContain('unknown rule knob "criticalTables"');
	});

	test("a re-registration REPLACES the entry with the same id", () => {
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "criticals.maxSeverity": 8 },
		});
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits (v2)",
			delta: { "criticals.maxSeverity": 6, "test.critOnDouble": false },
		});
		const registered = registeredModuleRuleProfiles();
		expect(registered).toHaveLength(1);
		expect(registered[0]?.name).toBe("Lethal crits (v2)");
		worldWith([], "lethal-crits");
		const effective = effectiveProfile();
		expect(effective.criticals?.maxSeverity).toBe(6);
		expect(effective.critOnDouble).toBe(false);
	});

	test("a FAILED re-registration leaves the accepted one in force", () => {
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "criticals.maxSeverity": 8 },
		});
		const warnings = captureWarnings(() => {
			expect(
				registerModuleRuleProfile({
					id: "lethal-crits",
					name: "Lethal crits (broken)",
					delta: { "criticals.maxSeverity": "eight" },
				}),
			).toBe(false);
		});
		// The running profile is the last one that VALIDATED, and the module
		// author is told why the new one was refused.
		expect(warnings[0]).toContain('rule profile "lethal-crits" rejected');
		expect(registeredModuleRuleProfiles()[0]?.name).toBe("Lethal crits");
		worldWith([], "lethal-crits");
		expect(effectiveProfile().criticals?.maxSeverity).toBe(8);
	});

	test("modules compose in registration order: the later one wins a shared knob", () => {
		registerModuleRuleProfile({
			id: "a",
			name: "A",
			delta: { "criticals.maxSeverity": 8 },
		});
		registerModuleRuleProfile({
			id: "b",
			name: "B",
			delta: { "criticals.maxSeverity": 6 },
		});
		worldWith([], "");
		expect(effectiveProfile().criticals?.maxSeverity).toBe(6);
	});

	test("the registration never mutates the base profile", () => {
		registerModuleRuleProfile({
			id: "lethal-crits",
			name: "Lethal crits",
			delta: { "criticals.maxSeverity": 8 },
		});
		worldWith([], "lethal-crits");
		effectiveProfile();
		expect(rtCore.criticals?.maxSeverity).not.toBe(8);
	});
});
