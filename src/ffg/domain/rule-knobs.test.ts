/**
 * Rule-knob registry + merge/validate (epic wxut, child B1).
 *
 * The registry is pure data and the pair is pure functions, so this file is
 * the bead's gate: no Foundry, no ports, no settings seam.
 */
import { describe, expect, test, afterEach } from "bun:test";

import { locationForHit } from "../../rules-engine/index";
import { rtCore } from "./system-profile";
import {
	hintKeyFor,
	knobByKey,
	knobsForGroup,
	labelKeyFor,
	mergeProfile,
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
	type RuleKnob,
	type RuleKnobRegistry,
	RT_RULE_KNOB_REGISTRY,
	ruleKnobKeys,
	ruleKnobRegistry,
	ruleKnobs,
	ruleProfilePackKindFor,
	RULE_KNOBS,
	RULE_KNOBS_EXCLUDED_KEYS,
	RULE_KNOB_KEYS,
	validateProfile,
} from "./rule-knobs";

/** Read the value a knob's path points at on a profile. */
function readAt(source: unknown, path: readonly string[]): unknown {
	let cursor = source;
	for (const segment of path) {
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/** The inventory this bead was scoped to, verbatim. */
const INVENTORY = [
	"test.critOnDouble",
	"test.autoFailRoll",
	"test.autoPassRoll",
	"damage.primitiveArmourDouble",
	"damage.righteousFury",
	"combat.fireModeBonus.burst",
	"combat.fireModeBonus.full",
	"psychic.pushCap.sanctioned",
	"psychic.pushCap.other",
	"ammo.autoConsume",
	"skills.untrainedSkill.model",
	"skills.untrainedSkill.penalty",
	"creation.characteristicBase",
	"creation.pointBuyBudget",
	"creation.pointBuyMax",
	"creation.creatorLastStep",
	"advancement.preSpentBaseline",
	"advancement.eliteAdvanceBaseCost",
	"toxic.penaltyPerDamagePoint",
	"criticals.maxSeverity",
	"battlesuit.repairTestModifier",
	"tables.hitLocations",
];

/** Table 9-6, read on the REVERSED roll (see kernel.test.ts). */
const HIT_LOCATION_CASES: Array<[number, string]> = [
	[10, "head"],
	[20, "head"],
	[90, "head"],
	[1, "head"],
	[11, "right-arm"],
	[21, "right-arm"],
	[91, "right-arm"],
	[12, "left-arm"],
	[22, "left-arm"],
	[92, "left-arm"],
	[13, "body"],
	[7, "body"],
	[66, "body"],
	[17, "right-leg"],
	[57, "right-leg"],
	[28, "right-leg"],
	[58, "right-leg"],
	[68, "left-leg"],
	[99, "left-leg"],
];

describe("rule-knob registry", () => {
	test("the inventory is exactly the bead's knob list, with no duplicates", () => {
		expect(RULE_KNOB_KEYS).toEqual(INVENTORY);
		expect(new Set(RULE_KNOB_KEYS).size).toBe(RULE_KNOB_KEYS.length);
	});

	test("every entry is well formed: group matches the key, control is known", () => {
		for (const knob of RULE_KNOBS) {
			expect(knob.key.split(".")[0], `${knob.key} group`).toBe(knob.group);
			expect(knob.path.length).toBeGreaterThan(0);
			expect(["number", "boolean", "select", "table"]).toContain(
				knob.control,
			);
			expect(["auto-recomputed", "creation-only", "ledger-assuming"]).toContain(
				knob.hazard,
			);
			if (knob.control === "select") {
				expect(knob.options?.length ?? 0).toBeGreaterThan(0);
			} else {
				expect(knob.options).toBeUndefined();
			}
		}
		// Every section the registry names is populated.
		for (const knob of RULE_KNOBS) {
			expect(knobsForGroup(knob.group).length).toBeGreaterThan(0);
		}
	});

	test("hazard classes are the scoped ones", () => {
		const ledger = RULE_KNOBS.filter(
			(knob) => knob.hazard === "ledger-assuming",
		).map((knob) => knob.key);
		expect(ledger).toEqual([
			"advancement.preSpentBaseline",
			"advancement.eliteAdvanceBaseCost",
		]);
		const creationOnly = RULE_KNOBS.filter(
			(knob) => knob.hazard === "creation-only",
		).map((knob) => knob.key);
		expect(creationOnly).toEqual([
			"creation.characteristicBase",
			"creation.pointBuyBudget",
			"creation.pointBuyMax",
			"creation.creatorLastStep",
		]);
		// Everything else is auto-recomputed.
		expect(
			RULE_KNOBS.filter((knob) => knob.hazard === "auto-recomputed").length,
		).toBe(RULE_KNOBS.length - ledger.length - creationOnly.length);
	});

	test("the registry holds no system-identity or extension-point key", () => {
		for (const excluded of RULE_KNOBS_EXCLUDED_KEYS) {
			expect(RULE_KNOB_KEYS, `${excluded} must stay out`).not.toContain(
				excluded,
			);
			const paths = RULE_KNOBS.map((knob) => knob.path.join("."));
			expect(paths, `${excluded} path must stay out`).not.toContain(excluded);
		}
	});

	test("knobByKey / knobsForGroup index the registry", () => {
		expect(knobByKey("tables.hitLocations")?.control).toBe("table");
		expect(knobByKey("nope")).toBeUndefined();
		expect(knobsForGroup("combat").map((knob) => knob.key)).toEqual([
			"combat.fireModeBonus.burst",
			"combat.fireModeBonus.full",
		]);
	});

	test("labelKey/hintKey follow the documented RULES. derivation", () => {
		expect(labelKeyFor("combat.fireModeBonus.burst")).toBe(
			"RULES.COMBAT_FIRE_MODE_BONUS_BURST",
		);
		expect(hintKeyFor("tables.hitLocations")).toBe(
			"RULES.TABLES_HIT_LOCATIONS.HINT",
		);
		// The shape matches the i18n parity guard's KEY_SHAPE, so the calls the
		// later bead adds will satisfy its static-reference scan.
		const KEY_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+$/;
		for (const knob of RULE_KNOBS) {
			expect(knob.labelKey).toBe(labelKeyFor(knob.key));
			expect(knob.hintKey).toBe(hintKeyFor(knob.key));
			expect(knob.labelKey).toMatch(KEY_SHAPE);
			expect(knob.hintKey).toMatch(KEY_SHAPE);
		}
	});

	test("every coreValue is READ from the profile field the knob claims", () => {
		for (const knob of RULE_KNOBS) {
			expect(
				knob.coreValue,
				`${knob.key} coreValue must be rtCore${knob.path.map((s) => `.${s}`).join("")}`,
			).toEqual(readAt(rtCore, knob.path));
		}
		// Spot-pin the claims themselves, so a wrong path cannot read an
		// unrelated field and still satisfy the loop above.
		const byKey = (key: string): RuleKnob => {
			const knob = knobByKey(key);
			if (!knob) throw new Error(`missing knob ${key}`);
			return knob;
		};
		expect(byKey("combat.fireModeBonus.burst").coreValue).toBe(10);
		expect(byKey("combat.fireModeBonus.full").coreValue).toBe(20);
		expect(byKey("psychic.pushCap.sanctioned").coreValue).toBe(3);
		expect(byKey("psychic.pushCap.other").coreValue).toBe(4);
		expect(byKey("ammo.autoConsume").coreValue).toBe(false);
		expect(byKey("skills.untrainedSkill.model").coreValue).toBe(
			"half-characteristic",
		);
		expect(byKey("skills.untrainedSkill.penalty").coreValue).toBeUndefined();
		expect(byKey("test.autoFailRoll").coreValue).toBeNull();
		expect(byKey("creation.characteristicBase").coreValue).toBe(25);
		expect(byKey("creation.pointBuyBudget").coreValue).toBe(100);
		expect(byKey("creation.pointBuyMax").coreValue).toBe(20);
		expect(byKey("creation.creatorLastStep").coreValue).toBe(5);
		expect(byKey("advancement.preSpentBaseline").coreValue).toBe(4500);
		expect(byKey("advancement.eliteAdvanceBaseCost").coreValue).toBe(500);
		expect(byKey("toxic.penaltyPerDamagePoint").coreValue).toBe(5);
		expect(byKey("criticals.maxSeverity").coreValue).toBe(10);
		expect(byKey("battlesuit.repairTestModifier").coreValue).toBe(-20);
		expect(byKey("tables.hitLocations").coreValue).toEqual(rtCore.hitLocations);
	});
});

describe("mergeProfile", () => {
	test("an empty delta yields core exactly", () => {
		expect(mergeProfile(rtCore, {})).toEqual(rtCore);
		// An explicitly-undefined value is an absent key.
		expect(
			mergeProfile(rtCore, { "combat.fireModeBonus.burst": undefined }),
		).toEqual(rtCore);
		expect(mergeProfile(rtCore, null)).toEqual(rtCore);
	});

	test("an absent key leaves the core value in place", () => {
		const merged = mergeProfile(rtCore, { "test.autoFailRoll": 95 });
		expect(merged.autoFailRoll).toBe(95);
		expect(merged).toEqual({ ...rtCore, autoFailRoll: 95 });
	});

	test("a leaf override leaves the sibling leaf at core (object knobs)", () => {
		const merged = mergeProfile(rtCore, { "combat.fireModeBonus.burst": 0 });
		expect(merged.fireModeBonus).toEqual({ burst: 0, full: 20 });
		// ...and the other object knob is untouched.
		expect(merged.pushCap).toEqual(rtCore.pushCap);
		expect(merged.fireModeBonus).not.toBe(rtCore.fireModeBonus);
	});

	test("an object-knob member keeps its sibling member (righteousFury)", () => {
		const merged = mergeProfile(rtCore, { "damage.righteousFury": false });
		expect(merged.righteousFury).toEqual({
			enabled: false,
			trigger: "damaging-hit",
		});
	});

	test("a discriminated-union member merges into a valid union", () => {
		const model = mergeProfile(rtCore, {
			"skills.untrainedSkill.model": "flat-penalty",
		});
		expect(model.untrainedSkill.model).toBe("flat-penalty");

		const both = mergeProfile(rtCore, {
			"skills.untrainedSkill.model": "flat-penalty",
			"skills.untrainedSkill.penalty": -10,
		});
		expect(both.untrainedSkill).toEqual({
			model: "flat-penalty",
			penalty: -10,
		});
		// Order does not matter: the sibling member survives either way.
		expect(
			mergeProfile(rtCore, {
				"skills.untrainedSkill.penalty": -10,
				"skills.untrainedSkill.model": "flat-penalty",
			}).untrainedSkill,
		).toEqual({ model: "flat-penalty", penalty: -10 });
	});

	test("tables.hitLocations is replaced WHOLE, never merged band-wise", () => {
		const merged = mergeProfile(rtCore, {
			"tables.hitLocations": { "01-05": "head" },
		});
		expect(merged.hitLocations).toEqual({ "01-05": "head" });
		// No core band survives the replacement.
		expect(Object.keys(merged.hitLocations)).toEqual(["01-05"]);
	});

	test("core is never mutated", () => {
		mergeProfile(rtCore, {
			"combat.fireModeBonus.burst": 0,
			"psychic.pushCap.sanctioned": 1,
			"tables.hitLocations": { "01-05": "head" },
			"skills.untrainedSkill.model": "flat-penalty",
		});
		expect(rtCore.fireModeBonus).toEqual({ burst: 10, full: 20 });
		expect(rtCore.pushCap).toEqual({ sanctioned: 3, other: 4 });
		expect(Object.keys(rtCore.hitLocations)).toEqual([
			"01-10",
			"11-20",
			"21-30",
			"31-70",
			"71-85",
			"86-00",
		]);
		expect(rtCore.untrainedSkill).toEqual({ model: "half-characteristic" });
	});

	test("an unknown key throws, NAMING the key", () => {
		expect(() => mergeProfile(rtCore, { nope: 1 })).toThrow(/nope/);
		// System identity is not a knob, so it cannot be smuggled in either.
		expect(() =>
			mergeProfile(rtCore, { messageFlagNamespace: "house" }),
		).toThrow(/messageFlagNamespace/);
	});
});

describe("merged hit locations keep the reverse-digit band keying", () => {
	test("replacing the table with itself preserves every band", () => {
		const merged = mergeProfile(rtCore, {
			"tables.hitLocations": rtCore.hitLocations,
		});
		for (const [roll, location] of HIT_LOCATION_CASES) {
			expect(locationForHit(roll, merged), `roll ${roll}`).toBe(location);
		}
	});

	test("Table 9-6 band boundaries: 10/85/86/95/00", () => {
		const merged = mergeProfile(rtCore, {
			"tables.hitLocations": rtCore.hitLocations,
		});
		expect(locationForHit(10, merged)).toBe("head"); // "10" -> 01
		expect(locationForHit(11, merged)).toBe("right-arm"); // 11
		expect(locationForHit(1, merged)).toBe("head"); // "01" -> 10
		expect(locationForHit(2, merged)).toBe("right-arm"); // "02" -> 20
		expect(locationForHit(7, merged)).toBe("body"); // "07" -> 70
		expect(locationForHit(17, merged)).toBe("right-leg"); // "17" -> 71
		expect(locationForHit(58, merged)).toBe("right-leg"); // 58 -> 85
		expect(locationForHit(57, merged)).toBe("right-leg"); // 57 -> 75
		expect(locationForHit(68, merged)).toBe("left-leg"); // 68 -> 86
		expect(locationForHit(78, merged)).toBe("left-leg"); // 78 -> 87
		expect(locationForHit(95, merged)).toBe("body"); // 95 -> 59
		expect(locationForHit(0, merged)).toBe("left-leg"); // 00 -> 100
		expect(locationForHit(100, merged)).toBe("left-leg");
	});

	test("a dropped band falls back to body (the kernel's out-of-band path)", () => {
		const narrow = mergeProfile(rtCore, {
			"tables.hitLocations": { "01-10": "head" },
		});
		expect(locationForHit(10, narrow)).toBe("head"); // 10 -> 01
		expect(locationForHit(11, narrow)).toBe("body"); // 11 -> 11: no band
	});
});

describe("validateProfile", () => {
	test("a core-value delta for every knob validates", () => {
		const core: Record<string, unknown> = {};
		for (const knob of RULE_KNOBS) {
			if (knob.coreValue !== undefined) core[knob.key] = knob.coreValue;
		}
		const result = validateProfile(RULE_KNOBS, core);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.value).toEqual(core);
	});

	test("an unknown key is NAMED and never silently dropped", () => {
		const result = validateProfile(RULE_KNOBS, {
			"creation.pointBuyMax": 15,
			"creation.pointBuyCeiling": 15, // typo'd near-neighbour
		});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0]).toContain("creation.pointBuyCeiling");
		expect(result.errors[0]).toContain("rejected");
		// The good key is still accepted; the bad one is reported, not absorbed.
		expect(result.value).toEqual({ "creation.pointBuyMax": 15 });
	});

	test("system identity and extension points are rejected by name", () => {
		for (const key of RULE_KNOBS_EXCLUDED_KEYS) {
			const result = validateProfile(RULE_KNOBS, { [key]: "x" });
			expect(result.valid, key).toBe(false);
			expect(result.errors[0], key).toContain(key);
			expect(result.value, key).toEqual({});
		}
	});

	test("wrong control types fail, naming the key", () => {
		const bad: Array<[Record<string, unknown>, string]> = [
			[{ "test.critOnDouble": "true" }, "test.critOnDouble"],
			[{ "test.autoFailRoll": "96" }, "test.autoFailRoll"],
			[{ "test.autoFailRoll": Number.NaN }, "test.autoFailRoll"],
			[{ "creation.pointBuyMax": null }, "creation.pointBuyMax"],
			[{ "ammo.autoConsume": 1 }, "ammo.autoConsume"],
			[
				{ "skills.untrainedSkill.model": "quarter-characteristic" },
				"skills.untrainedSkill.model",
			],
			[{ "tables.hitLocations": [] }, "tables.hitLocations"],
			[{ "tables.hitLocations": { "1-10": "head" } }, "tables.hitLocations"],
			[{ "tables.hitLocations": { "01-10": "" } }, "tables.hitLocations"],
		];
		for (const [delta, key] of bad) {
			const result = validateProfile(RULE_KNOBS, delta);
			expect(result.valid, key).toBe(false);
			expect(result.errors[0], key).toContain(key);
			expect(result.value, key).toEqual({});
		}
		// The select error lists what IS allowed.
		expect(
			validateProfile(RULE_KNOBS, {
				"skills.untrainedSkill.model": "quarter-characteristic",
			}).errors[0],
		).toContain("half-characteristic | flat-penalty");
	});

	test("nullable bands accept null; non-nullable numbers do not", () => {
		expect(
			validateProfile(RULE_KNOBS, { "test.autoFailRoll": null }).valid,
		).toBe(true);
		expect(validateProfile(RULE_KNOBS, { "test.autoPassRoll": 5 }).valid).toBe(
			true,
		);
		expect(
			validateProfile(RULE_KNOBS, { "creation.characteristicBase": null })
				.valid,
		).toBe(false);
	});

	test("the registry is an argument, so a narrower set is honoured", () => {
		const only = RULE_KNOBS.filter((knob) => knob.group === "creation");
		expect(validateProfile(only, { "test.critOnDouble": false }).valid).toBe(
			false,
		);
		expect(validateProfile(only, { "creation.pointBuyMax": 15 }).valid).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// Whose registry? (bead w9sa.2)
// ---------------------------------------------------------------------------

/**
 * A FAKE sibling system, in the shape bead w9sa.3 will author DH2's for real.
 *
 * Its knobs are deliberately DIFFERENT from RT's — inverted fire modes (a
 * penalty), no push caps, a flat untrained penalty — so a test that still
 * resolves RT's knobs cannot pass by accident. The paths point at fields the
 * RT profile really has, because the fake's purpose is the REGISTRY, not a
 * second profile type (bead w9sa.3 owns that).
 */
const SIBLING_SYSTEM_ID = "dark-heresy-2e";
const SIBLING_KNOBS: readonly RuleKnob[] = [
	{
		key: "test.doublesAreCrits",
		path: ["critOnDouble"],
		labelKey: labelKeyFor("test.doublesAreCrits"),
		hintKey: hintKeyFor("test.doublesAreCrits"),
		group: "test",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.critOnDouble,
	},
	{
		key: "combat.standardMode",
		path: ["fireModeBonus", "burst"],
		labelKey: labelKeyFor("combat.standardMode"),
		hintKey: hintKeyFor("combat.standardMode"),
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.fireModeBonus.burst,
	},
	{
		key: "skills.untrainedPenalty",
		path: ["untrainedSkill", "penalty"],
		labelKey: labelKeyFor("skills.untrainedPenalty"),
		hintKey: hintKeyFor("skills.untrainedPenalty"),
		group: "skills",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 20,
	},
];
const SIBLING_REGISTRY: RuleKnobRegistry = {
	systemId: SIBLING_SYSTEM_ID,
	knobs: SIBLING_KNOBS,
};

// The binding is module-global and bun runs every suite in ONE process, so a
// leaked registry would quietly retune the RT suites that run later — the same
// leak resetModuleRuleProfilesForTests guards on the homebrew side.
afterEach(() => {
	resetRuleKnobRegistryForTests();
});

describe("the active registry is RT's until something registers another", () => {
	test("the default binding is Rogue Trader's own registry", () => {
		const registry = ruleKnobRegistry();
		expect(registry.systemId).toBe("rogue-trader");
		expect(registry.knobs).toBe(RULE_KNOBS);
		expect(ruleKnobs()).toBe(RULE_KNOBS);
		expect(ruleKnobKeys()).toEqual(RULE_KNOB_KEYS);
	});

	test("one call swaps the binding, and the rest of the API follows it", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		expect(ruleKnobRegistry().systemId).toBe(SIBLING_SYSTEM_ID);
		expect(ruleKnobs().map((knob) => knob.key)).toEqual([
			"test.doublesAreCrits",
			"combat.standardMode",
			"skills.untrainedPenalty",
		]);
		// The reads that DEFAULT to the active registry follow the swap: an RT
		// key is no longer registered, a sibling key is.
		expect(knobByKey("combat.fireModeBonus.burst")).toBeUndefined();
		expect(knobByKey("combat.standardMode")?.control).toBe("number");
		expect(knobsForGroup("combat").map((knob) => knob.key)).toEqual([
			"combat.standardMode",
		]);
		// ...and so does the merge, whose unknown-key error names the keys THIS
		// registry knows rather than Rogue Trader's.
		expect(() =>
			mergeProfile(rtCore, { "combat.fireModeBonus.burst": 0 }),
		).toThrow(/combat.standardMode/);
		expect(
			mergeProfile(rtCore, { "combat.standardMode": -10 }, SIBLING_KNOBS)
				.fireModeBonus.burst,
		).toBe(-10);
	});

	test("the reset restores RT, so no suite leaks a foreign registry", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		resetRuleKnobRegistryForTests();
		expect(ruleKnobRegistry().systemId).toBe("rogue-trader");
		expect(ruleKnobs()).toBe(RULE_KNOBS);
	});
});

describe("the rules-pack kind is DERIVED from the system id", () => {
	test("<systemId>.rule-profiles, with no second literal anywhere", () => {
		expect(ruleProfilePackKindFor("rogue-trader")).toBe(
			"rogue-trader.rule-profiles",
		);
		expect(ruleProfilePackKindFor(SIBLING_SYSTEM_ID)).toBe(
			"dark-heresy-2e.rule-profiles",
		);
		expect(RT_RULE_KNOB_REGISTRY.systemId).toBe("rogue-trader");
	});
});

describe("a foreign registry is honoured end to end by the pure pair", () => {
	test("validateProfile accepts the sibling's keys and NAMES RT's", () => {
		const accepted = validateProfile(SIBLING_REGISTRY.knobs, {
			"combat.standardMode": -10,
			"skills.untrainedPenalty": 20,
		});
		expect(accepted.valid).toBe(true);
		expect(accepted.value).toEqual({
			"combat.standardMode": -10,
			"skills.untrainedPenalty": 20,
		});
		// An RT knob key is UNKNOWN to the sibling registry — named, not
		// silently dropped, so a pack that cannot import says which key.
		const rejected = validateProfile(SIBLING_REGISTRY.knobs, {
			"combat.fireModeBonus.burst": 0,
		});
		expect(rejected.valid).toBe(false);
		expect(rejected.errors[0]).toContain("combat.fireModeBonus.burst");
		expect(rejected.value).toEqual({});
	});
});

describe("mergeProfile drives a FOREIGN base profile (bead w9sa.2)", () => {
	// The sibling registry writes to fields rtCore does not have (a flat
	// untrained penalty instead of RT's half-characteristic model). Before the
	// generic signature this was impossible without a second merge path, and a
	// DarkHeresyProfile could not drive the machinery at all.
	const foreignBase = {
		id: "dh2-core",
		// The fields the SIBLING registry's paths actually address — deliberately
		// NOT all present on rtCore, which is the point: this shape is what a
		// DarkHeresyProfile would own once its own knob registry lands (.3).
		critOnDouble: true,
		fireModeBonus: { burst: 10, full: 20 },
		untrainedSkill: { penalty: 20 },
		nested: { a: 1, b: 2 },
		list: [1, 2],
	};

	test("a foreign base merges its own knobs, RT's are unknown", () => {
		const merged = mergeProfile(foreignBase, {
			"skills.untrainedPenalty": -10,
		}, SIBLING_REGISTRY.knobs);
		expect(merged.untrainedSkill).toEqual({ penalty: -10 });
		// Leaf-merge: the sibling's siblings stay at the foreign base's values.
		expect(merged.fireModeBonus).toEqual({ burst: 10, full: 20 });
		// The foreign base's own shape is carried through untouched.
		expect(merged.id).toBe("dh2-core");
		expect(merged.nested).toEqual({ a: 1, b: 2 });
		expect(merged.list).toEqual([1, 2]);
	});

	test("the foreign base is never mutated and never aliased", () => {
		mergeProfile(foreignBase, {
			"skills.untrainedPenalty": 0,
			"combat.standardMode": 5,
		}, SIBLING_REGISTRY.knobs);
		expect(foreignBase.untrainedSkill).toEqual({ penalty: 20 });
		expect(foreignBase.fireModeBonus).toEqual({ burst: 10, full: 20 });
	});

	test("an RT knob key is unknown to the sibling registry and is NAMED", () => {
		expect(() =>
			mergeProfile(foreignBase, {
				"combat.fireModeBonus.burst": 0,
			}, SIBLING_REGISTRY.knobs),
		).toThrow(/combat\.fireModeBonus\.burst/);
	});
});
