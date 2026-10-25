/**
 * Effective-profile seam (bead 9if, reworked by epic wxut bead .2).
 *
 * There are no per-rule resolvers any more: a world's house rules are a
 * knob-keyed delta validated by the registry and merged over the base profile
 * by `effectiveProfile()`. These tests pin the seam's contract:
 *   - storage decoding (string/object/empty) — the successor of
 *     parseHomebrewProfile, storage shape only;
 *   - validation is LOUD: an unknown or wrong-typed knob is warned and ignored,
 *     never silently applied (bead 083c ·2 — a malformed object is no longer
 *     accepted just because it arrived as an object);
 *   - core rules apply when nothing is configured, and the base profile object
 *     is returned AS IS so identity checks keep working;
 *   - the provider's lookup of the active named profile (bead wxut.3) is
 *     LOOKUP ONLY and never throws (rules/homebrew.ts#activeProfileDelta);
 *   - the merge is memoised on the raw stored value, so a roll reads the
 *     settings ONCE instead of re-parsing the profile every attack (qa9k).
 *
 * Bead x4ly: the profile is read through a caller-bound ConfigPort — these
 * tests bind ConfigPort doubles; no Foundry port swap needed at all.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { rtCore } from "../../ffg/domain/system-profile";
import {
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
	type RuleKnob,
	type RuleKnobRegistry,
} from "../../ffg/domain/rule-knobs";
import type { ConfigPort } from "../../ffg/application/ports";
import {
	activeProfileDelta,
	effectiveProfile,
	HOMEBREW_SETTING,
	isRtSystemProfile,
	parseStoredDelta,
	registerModuleRuleProfile,
	resetEffectiveProfileCacheForTests,
	resetModuleRuleProfilesForTests,
} from "./homebrew";

// Bead x4ly: `effectiveProfile` takes its ConfigPort as a parameter, so these
// tests bind a ConfigPort DOUBLE directly — no `as unknown as Ports` cast and
// no setPorts global swap. The rules layer no longer reads a global.
afterEach(() => {
	// A leaked registry would quietly retune the suites that run after this
	// one (bun runs them all in one process).
	resetRuleKnobRegistryForTests();
});

/** A ConfigPort double whose homebrew seam answers with the given value. */
function configWithHomebrew(stored: unknown): ConfigPort {
	return {
		homebrew: () => stored,
		profile: () => rtCore,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
	};
}

/** `configWithHomebrew`, but the base profile is swapped — the OTHER half of
 * `effectiveProfile`'s memo key (bead qa9k). */
function configWithHomebrewBase(stored: unknown, base: unknown): ConfigPort {
	return {
		homebrew: () => stored,
		profile: () => base as never,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
	};
}

/** A stored `ruleProfiles` list, as the provider would read it from settings. */
const STORED_PROFILES = JSON.stringify([
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

describe("parseStoredDelta (storage decoding only)", () => {
	test("empty stored values mean core rules", () => {
		expect(parseStoredDelta("")).toBeNull();
		expect(parseStoredDelta(null)).toBeNull();
		expect(parseStoredDelta(undefined)).toBeNull();
		expect(parseStoredDelta("   ")).toBeNull();
	});

	test("JSON text and objects both decode to a delta candidate", () => {
		expect(parseStoredDelta('{"combat.fireModeBonus.burst":0}')).toEqual({
			"combat.fireModeBonus.burst": 0,
		});
		expect(parseStoredDelta({ "ammo.autoConsume": true })).toEqual({
			"ammo.autoConsume": true,
		});
	});

	test("malformed JSON is reported and yields core rules", () => {
		expect(parseStoredDelta("not json")).toBeNull();
	});

	test("a non-object JSON scalar is not a delta", () => {
		expect(parseStoredDelta("42")).toBeNull();
	});
});

describe("effectiveProfile (bead wxut.2 seam)", () => {
	test("with no house rules the base profile is returned AS IS", () => {
		// Identity, not just equality: sibling-module swaps and tests rely on it.
		expect(effectiveProfile(configWithHomebrew(""))).toBe(rtCore);
		expect(effectiveProfile(configWithHomebrew(null))).toBe(rtCore);
	});

	test("a knob-keyed delta merges over the base profile", () => {
		const effective = effectiveProfile(configWithHomebrew('{"combat.fireModeBonus.burst":0}'));
		// Bead cmio.2: the knob's VALUE lives on the shared FireModes shape now
		// (the settings key is unchanged, the profile path moved).
		expect(effective.fireModes).toEqual({
			...rtCore.fireModes,
			semiAutoBurst: {
				...rtCore.fireModes.semiAutoBurst,
				modifier: 0,
			},
		});
		// Siblings untouched, and the base profile is not mutated.
		expect(effective.psychicPush).toEqual(rtCore.psychicPush);
		expect(rtCore.fireModes.semiAutoBurst.modifier).toBe(10);
	});

	test("an UNKNOWN knob is reported and never applied", () => {
		// The legacy (bead 9if) object shape is not knob-keyed, so it is
		// rejected by name rather than silently ignored.
		const effective = effectiveProfile(
			configWithHomebrew('{"fireModeBonus":{"burst":0,"full":10}}'),
		);
		expect(effective).toBe(rtCore);
	});

	test("an empty delta leaves core rules in place", () => {
		expect(effectiveProfile(configWithHomebrew("{}"))).toBe(rtCore);
	});

	// Bead 083c ·2: bead 9if's parser accepted ANY object on its object
	// branch — including one with no id and no knobs at all — so a malformed
	// value could ride straight into the rules. The knob-keyed delta is the
	// only shape that activates a rule now.
	test("a MALFORMED object-shaped stored value cannot activate a rule (083c ·2)", () => {
		// The bead-9if object branch, verbatim: an id and house values. Not a
		// knob-keyed delta, so it activates nothing.
		expect(effectiveProfile(configWithHomebrew({ id: "house", fireModeBonus: { burst: 0, full: 10 } }))).toBe(rtCore);
		expect(effectiveProfile(configWithHomebrew({ id: "house", fireModeBonus: { burst: 0, full: 10 } })).fireModes).toEqual(rtCore.fireModes);
		// Not even a half-formed one: an id with no knobs, no knobs with no id.
		expect(effectiveProfile(configWithHomebrew({ id: "house" }))).toBe(rtCore);
		expect(effectiveProfile(configWithHomebrew({ fireModeBonus: { burst: 0, full: 10 } }))).toBe(rtCore);
		expect(effectiveProfile(configWithHomebrew([{ id: "house", delta: { "ammo.autoConsume": true } }]))).toBe(rtCore);
	});

	test("the settings key is the legacy homebrewProfile key", () => {
		expect(HOMEBREW_SETTING).toBe("homebrewProfile");
	});
});

// --- The provider's lookup: named rule profiles (bead wxut.3) ---------------

describe("activeProfileDelta — the provider's profile lookup (bead wxut.3)", () => {
	test("the NAMED profile's delta comes back, unmerged", () => {
		// LOOKUP ONLY: the raw knob-keyed delta of the active row. No base
		// profile fields ride along — that merging is the seam's job.
		expect(activeProfileDelta(STORED_PROFILES, "strict")).toEqual({
			"ammo.autoConsume": true,
		});
		expect(activeProfileDelta(STORED_PROFILES, "berners")).toEqual({
			"combat.fireModeBonus.burst": 0,
		});
	});

	test("an unset, blank or unknown id means core rules", () => {
		for (const activeProfileId of [
			"",
			"   ",
			"nope",
			null,
			undefined,
			7,
			{ id: "strict" },
		]) {
			expect(activeProfileDelta(STORED_PROFILES, activeProfileId)).toBeNull();
		}
	});

	test("an id is trimmed, so a padded one still resolves", () => {
		expect(activeProfileDelta(STORED_PROFILES, " strict ")).toEqual({
			"ammo.autoConsume": true,
		});
	});

	test("a list that is not a list means core rules", () => {
		for (const stored of [
			"not json",
			'{"id":"berners"}',
			"[]",
			"{}",
			"42",
			"",
			null,
			undefined,
			7,
		]) {
			expect(activeProfileDelta(stored, "berners")).toBeNull();
		}
	});

	test("a row with no usable delta is skipped, never activated", () => {
		// No delta at all, a null delta, a non-object row and a numeric id.
		const rows = JSON.stringify([
			{ id: "berners", name: "B" },
			{ id: "berners", delta: null },
			"berners",
			{ id: 42, name: "B", delta: { "ammo.autoConsume": true } },
		]);
		expect(activeProfileDelta(rows, "berners")).toBeNull();
		expect(activeProfileDelta(rows, "42")).toBeNull();
	});

	test("an empty delta is the same as no profile at all", () => {
		for (const delta of [{}, []]) {
			const rows = JSON.stringify([{ id: "berners", name: "B", delta }]);
			expect(activeProfileDelta(rows, "berners")).toBeNull();
		}
	});

	test("the first row wins when ids repeat", () => {
		const rows = JSON.stringify([
			{ id: "dupe", name: "first", delta: { "ammo.autoConsume": true } },
			{
				id: "dupe",
				name: "second",
				delta: { "combat.fireModeBonus.burst": 5 },
			},
		]);
		expect(activeProfileDelta(rows, "dupe")).toEqual({
			"ammo.autoConsume": true,
		});
	});

	test("the lookup never THROWS — it only ever returns a delta or null", () => {
		expect(() =>
			activeProfileDelta('{"id":"berners"}', "berners"),
		).not.toThrow();
		expect(activeProfileDelta("[]", "berners")).toBeNull();
	});

	test("the delta the provider hands the seam is what the seam merges", () => {
		// End to end: settings -> provider lookup -> validated merge.
		const delta = activeProfileDelta(STORED_PROFILES, "berners");
		expect(effectiveProfile(configWithHomebrew(delta)).fireModes).toEqual({
			...rtCore.fireModes,
			semiAutoBurst: { ...rtCore.fireModes.semiAutoBurst, modifier: 0 },
		});
		// A delta that is not knob-keyed is rejected by validateProfile, so the
		// lookup alone cannot put a house rule into force.
		expect(
			effectiveProfile(
				configWithHomebrew(activeProfileDelta(STORED_PROFILES, "strict")),
			).ammoAutoConsume,
		).toBe(true);
	});
});

// --- Memoisation: the profile is decoded once per stored value (bead qa9k) ---

describe("effectiveProfile memoisation (bead qa9k)", () => {
	test("two identical reads return the SAME object", () => {
		// The memo is process-global, so drop it for a deterministic read.
		resetEffectiveProfileCacheForTests();
		const config = configWithHomebrew('{"combat.fireModeBonus.burst":0}');
		const first = effectiveProfile(config);
		const second = effectiveProfile(config);
		expect(second).toBe(first);
	});

	test("the stored value is decoded ONCE across repeated attack rolls (qa9k)", () => {
		// The finding's core: every attack roll reached the seam, so every roll
		// paid for a decode. Count JSON.parse — the seam's only decode step —
		// over ten reads of one stored value.
		resetEffectiveProfileCacheForTests();
		const parse = spyOn(JSON, "parse");
		try {
			for (let roll = 0; roll < 10; roll++)
				effectiveProfile(
					configWithHomebrew('{"combat.fireModeBonus.burst":0}'),
				);
			expect(parse).toHaveBeenCalledTimes(1);
		} finally {
			parse.mockRestore();
		}
	});

	test("a changed setting invalidates the memo and re-decodes", () => {
		// The settings-change event's OBSERVABLE effect is that the provider's
		// next read returns different stored text; the raw value is the memo key,
		// so that alone is the invalidation (no Foundry hook to mistype).
		resetEffectiveProfileCacheForTests();
		const parse = spyOn(JSON, "parse");
		try {
			const first = effectiveProfile(
				configWithHomebrew('{"combat.fireModeBonus.burst":0}'),
			);
			// The GM saves an edit: the provider now answers with the new text.
			const second = effectiveProfile(
				configWithHomebrew('{"combat.fireModeBonus.burst":7}'),
			);
			expect(parse).toHaveBeenCalledTimes(2);
			expect(second).not.toBe(first);
			expect(second.fireModes.semiAutoBurst.modifier).toBe(7);
			// Re-reading the NEW value is a memo hit again, not a third decode.
			expect(
				effectiveProfile(
					configWithHomebrew('{"combat.fireModeBonus.burst":7}'),
				),
			).toBe(second);
			expect(parse).toHaveBeenCalledTimes(2);
		} finally {
			parse.mockRestore();
		}
	});

	test("a changed stored value recomputes", () => {
		resetEffectiveProfileCacheForTests();
		const first = effectiveProfile(configWithHomebrew('{"combat.fireModeBonus.burst":0}'));
		const second = effectiveProfile(configWithHomebrew('{"combat.fireModeBonus.burst":5}'));
		expect(second).not.toBe(first);
		expect(first.fireModes.semiAutoBurst.modifier).toBe(0);
		expect(second.fireModes.semiAutoBurst.modifier).toBe(5);
	});

	test("a swapped base profile recomputes too", () => {
		resetEffectiveProfileCacheForTests();
		const stored = '{"combat.fireModeBonus.burst":0}';
		const first = effectiveProfile(configWithHomebrew(stored));
		const sibling = { ...rtCore, id: "sibling-core" };
		const second = effectiveProfile(configWithHomebrewBase(stored, sibling));
		expect(second).not.toBe(first);
		expect(second.fireModes.semiAutoBurst.modifier).toBe(0);
		// Neither the base nor the memoised result is mutated by the merge.
		expect(sibling.fireModes).toEqual(rtCore.fireModes);
		// The memo holds ONE entry, so swapping back recomputes an equal (but
		// not identical) profile — correct either way, since the merge is pure.
		expect(effectiveProfile(configWithHomebrewBase(stored, rtCore))).toEqual(first);
	});

	test("an inert profile is reported ONCE, not once per roll (qa9k)", () => {
		// The bug qa9k absorbed: settings were read and the profile parsed on
		// EVERY attack roll, so a malformed value warned forever. Warn once.
		resetEffectiveProfileCacheForTests();
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			for (let roll = 0; roll < 25; roll++)
				effectiveProfile(configWithHomebrew("not json"));
			for (let roll = 0; roll < 25; roll++)
				effectiveProfile(
					configWithHomebrew('{"fireModeBonus":{"burst":0,"full":10}}'),
				);
		} finally {
			console.warn = original;
		}
		// One warn per DISTINCT stored value: the malformed JSON, then the
		// unknown knob. Not 50.
		expect(warnings).toHaveLength(2);
	});
});

describe("drift guards — the shipped core values", () => {
	test("fire-mode modifiers stay the book's +10/+20 under the shared shape (Core Rulebook p237)", () => {
		expect(rtCore.fireModes.standard.modifier).toBe(0);
		expect(rtCore.fireModes.semiAutoBurst.modifier).toBe(10);
		expect(rtCore.fireModes.fullAutoBurst.modifier).toBe(20);
	});

	test("push caps stay Table 6-1's +3/+4 (Core Rulebook p157)", () => {
		expect(rtCore.psychicPush).toEqual({
			model: "levels",
			caps: { sanctioned: 3, other: 4 },
		});
	});

	test("the ammo toggle ships OFF (epic ui4b, book-accurate)", () => {
		expect(rtCore.ammoAutoConsume).toBe(false);
	});

	test("toxin penalty and the other lifted constants stay at book values", () => {
		expect(rtCore.penaltyPerDamagePoint).toBe(5);
		expect(rtCore.eliteAdvanceCost).toEqual({
			model: "flat-base",
			baseCost: 500,
		});
		expect(rtCore.repairTestModifier).toBe(-20);
		expect(rtCore.criticals?.maxSeverity).toBe(10);
	});
});

// --- Whose registry? (bead w9sa.2) ----------------------------------------

/**
 * A FAKE sibling system, in the shape bead w9sa.3 authors DH2's for real: a
 * Standard Attack knob where RT has a Semi-Auto Burst BONUS, a flat untrained
 * penalty where RT halves the characteristic, and no push cap at all. The keys
 * share nothing with RT's, so a seam that still resolves Rogue Trader's knobs
 * cannot pass by accident.
 */
	const SIBLING_KNOBS: readonly RuleKnob[] = [
	{
		key: "combat.standardMode",
		path: ["fireModes", "standard", "modifier"],
		labelKey: "RULES.COMBAT_STANDARD_MODE",
		hintKey: "RULES.COMBAT_STANDARD_MODE_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 10,
	},
	{
		key: "skills.untrainedPenalty",
		path: ["untrainedSkill", "penalty"],
		labelKey: "RULES.SKILLS_UNTRAINED_PENALTY",
		hintKey: "RULES.SKILLS_UNTRAINED_PENALTY_HINT",
		group: "skills",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 20,
	},
];
const SIBLING_REGISTRY: RuleKnobRegistry = {
	systemId: "dark-heresy-2e",
	// A test fake, not a shipped system: it reuses the incumbent flat namespace
	// so its hand-written label literals stay valid (bead w9sa.11 namespaces
	// real registries; the no-sibling-names guard runs over those only).
	i18nPrefix: "",
	knobs: SIBLING_KNOBS,
};

describe("the seam validates and merges against the registry in force", () => {
	test("a heap of RT house rules still works with nothing registered", () => {
		resetEffectiveProfileCacheForTests();
		expect(
			effectiveProfile(configWithHomebrew('{"combat.fireModeBonus.burst":0}')).fireModes.semiAutoBurst.modifier,
		).toBe(0);
	});

	test("a sibling registry makes RT's keys UNKNOWN and its own mergeable", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		resetEffectiveProfileCacheForTests();
		// RT's knob is not in the registry in force: reported once, never
		// applied, and the base profile comes back AS IS.
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			expect(effectiveProfile(configWithHomebrew('{"combat.fireModeBonus.burst":0}'))).toBe(rtCore);
		} finally {
			console.warn = original;
		}
		expect(warnings.join(" ")).toContain("combat.fireModeBonus.burst");
		// The sibling's own knob key now carries a house rule — it paths into
		// the shared FireModes shape's standard mode (the sibling's OWN path
		// data; the sibling fixture mirrors the kernel shape).
		expect(effectiveProfile(configWithHomebrew('{"combat.standardMode":-10}')).fireModes.standard.modifier).toBe(-10);
		// Sibling leaves of the same container stay at RT's core.
		expect(effectiveProfile(configWithHomebrew('{"combat.standardMode":-10}')).fireModes.fullAutoBurst.modifier).toBe(20);
	});

	test("a MODULE registration is validated against the registry in force", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		expect(
			registerModuleRuleProfile({
				id: "standard",
				name: "Standard mode",
				delta: { "combat.standardMode": -10 },
			}),
		).toBe(true);
		// An RT knob key is refused BY NAME, not silently accepted.
		expect(
			registerModuleRuleProfile({
				id: "burst",
				name: "Burst friendly",
				delta: { "combat.fireModeBonus.burst": 0 },
			}),
		).toBe(false);
		resetModuleRuleProfilesForTests();
	});
});

describe("the seam refuses a profile without RT's rule fields (bead w9sa.8)", () => {
	test("a kernel+branding-only profile is refused LOUDLY, naming the fields", () => {
		// The config port widens to the kernel profile plus optional branding, so
		// RT's own constants are no longer guaranteed by the type. RT's rules
		// read them, so the seam states the precondition instead of casting and
		// producing NaN three layers away.
		const config: ConfigPort = {
			homebrew: () => null,
			profile: () => ({
				id: "dh2-core",
				messageFlagNamespace: "dark-heresy-2e",
				rollCardTemplate: "",
			}) as never,
			originTraits: () => [],
			packIds: () => ({ rolltables: null }),
		};
		expect(() => effectiveProfile(config)).toThrow(
			/missing: fireModes, psychicPush, untrainedSkill, eliteAdvanceCost/,
		);
	});

	test("a full RT profile passes the guard unchanged", () => {
		expect(isRtSystemProfile(rtCore)).toBe(true);
		expect(isRtSystemProfile({ id: "x" })).toBe(false);
	});
});
