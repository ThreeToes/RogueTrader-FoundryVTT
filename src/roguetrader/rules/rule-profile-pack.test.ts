/**
 * Rules pack parsing and building (epic wxut, child B5).
 *
 * Import is NOT the tolerant path. `parseStoredDelta` (homebrew.ts) warns and
 * falls back because a world's own stored value must never stop the rules from
 * running; a pack a GM hands over is the opposite case, so every scenario here
 * pins a LOUD refusal that names the offending key, kind or schema version.
 *
 * The three invariants these guards exist to keep:
 *   1. all or nothing — one bad profile refuses the whole pack, so nobody
 *      imports four good profiles and finds the typo three sessions later;
 *   2. the snapshot is display-only — it is carried through and NEVER
 *      resolved, so metadata cannot quietly become a second source of truth;
 *   3. the round trip is exact — export -> import -> export is byte-identical
 *      for the active profile and for all profiles, which is the whole point
 *      of a shareable house rule.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rtCore } from "../../ffg/domain/system-profile";
import {
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
	type RuleKnob,
	type RuleKnobRegistry,
	RT_RULE_KNOB_REGISTRY,
	ruleProfilePackKindFor,
} from "../../ffg/domain/rule-knobs";
import {
	buildRuleProfilePack,
	packProfileEffective,
	packProblemMessage,
	packProblemParams,
	parseRuleProfilePack,
	RULE_PROFILE_PACK_KIND,
	RULE_PROFILE_PACK_SCHEMA_VERSION,
	ruleProfilePackJson,
	type RuleProfilePackBase,
	type RuleProfilePackRow,
} from "./rule-profile-pack";

/** The base every export in these tests claims. */
const BASE: RuleProfilePackBase = { profile: "rt-core", systemVersion: "9.9.9" };

function pack(profiles: unknown[], extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		kind: RULE_PROFILE_PACK_KIND,
		schemaVersion: RULE_PROFILE_PACK_SCHEMA_VERSION,
		profiles,
		...extra,
	});
}

/** A well-formed profile entry (the happy path every other case bends). */
function entry(id: string, delta: Record<string, unknown>): Record<string, unknown> {
	return { id, name: id.toUpperCase(), base: { profile: "rt-core" }, delta };
}

describe("parseRuleProfilePack — pack-level guards", () => {
	test("text that is not JSON is refused, naming the parser's message", () => {
		const result = parseRuleProfilePack("{ not json");
		expect(result.valid).toBe(false);
		expect(result.profiles).toEqual([]);
		expect(result.problems).toEqual([
			expect.objectContaining({ kind: "not-json" }),
		]);
		expect(result.errors[0]).toContain("not valid JSON");
	});

	test("a non-object pack is refused with what it actually was", () => {
		for (const [value, got] of [
			["[]", "an array"],
			["42", "the number 42"],
			['"rogue-trader.rule-profiles"', 'the string "rogue-trader.rule-profiles"'],
		] as const) {
			const result = parseRuleProfilePack(value);
			expect(result.valid).toBe(false);
			expect(result.problems[0]).toEqual({ kind: "not-an-object", got });
		}
	});

	test("a wrong kind is an ERROR naming the kind — never a silent fallback", () => {
		const result = parseRuleProfilePack(
			pack([entry("lethal", { "test.critOnDouble": false })], {
				kind: "dark-heresie.rule-profiles",
			}),
		);
		expect(result.valid).toBe(false);
		expect(result.profiles).toEqual([]);
		const problem = result.problems[0];
		expect(problem?.kind).toBe("wrong-kind");
		// The refusal NAMES the offending kind and the expected one: a sibling
		// system's pack is rejected, not translated (epic non-goal).
		expect(packProblemMessage(problem!)).toContain("dark-heresie.rule-profiles");
		expect(packProblemMessage(problem!)).toContain(RULE_PROFILE_PACK_KIND);
	});

	test("a missing kind is the same refusal, with 'nothing' for what was there", () => {
		const result = parseRuleProfilePack(
			JSON.stringify({ schemaVersion: 1, profiles: [] }),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({
			kind: "wrong-kind",
			got: "nothing",
			expected: `"${RULE_PROFILE_PACK_KIND}"`,
		});
	});

	test("an unsupported schemaVersion names the supported range", () => {
		for (const version of [2, 0, 1.5, "1", null, undefined]) {
			const result = parseRuleProfilePack(
				pack([entry("lethal", { "test.critOnDouble": false })], {
					schemaVersion: version,
				}),
			);
			expect(result.valid).toBe(false);
			expect(result.problems[0]?.kind).toBe("unsupported-schema");
			expect(packProblemMessage(result.problems[0]!)).toContain("1");
			expect(packProblemParams(result.problems[0]!).supported).toBe("1");
		}
	});

	test("profiles must be an array", () => {
		const result = parseRuleProfilePack(pack([], { profiles: { lethal: {} } }));
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({
			kind: "profiles-not-a-list",
			got: "an object",
		});
	});

	test("an empty profiles array is valid and imports nothing", () => {
		const result = parseRuleProfilePack(pack([]));
		expect(result.valid).toBe(true);
		expect(result.profiles).toEqual([]);
		expect(result.problems).toEqual([]);
	});
});
describe("parseRuleProfilePack — profile-level guards", () => {
	test("a profile that is not an object is refused by position", () => {
		const result = parseRuleProfilePack(pack(["lethal", entry("ok", {})]));
		expect(result.valid).toBe(false);
		expect(result.problems).toEqual([
			{ kind: "profile-not-a-row", index: 1, got: "the string \"lethal\"" },
		]);
	});

	test("a profile with no id is refused by position", () => {
		const result = parseRuleProfilePack(
			pack([{ name: "nameless", delta: {} }]),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({ kind: "profile-no-id", index: 1 });
	});

	test("a profile whose delta is not an object is refused, naming the id", () => {
		const result = parseRuleProfilePack(
			pack([{ id: "lethal", name: "Lethal", delta: "test.critOnDouble" }]),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({
			kind: "profile-no-delta",
			index: 1,
			id: "lethal",
		});
	});

	test("the same id twice in one pack is refused (merge would be ambiguous)", () => {
		const result = parseRuleProfilePack(
			pack([entry("lethal", {}), entry("lethal", {})]),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({
			kind: "profile-duplicate-id",
			index: 2,
			id: "lethal",
		});
	});

	test("a malformed base is refused rather than ignored", () => {
		const result = parseRuleProfilePack(
			pack([{ id: "lethal", delta: {}, base: "rt-core" }]),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]?.kind).toBe("profile-bad-base");
	});

	test("an unknown knob key is NAMED and the whole pack is refused", () => {
		const result = parseRuleProfilePack(
			pack([
				entry("lethal", {
					"test.critOnDouble": false,
					"combat.fireModeBonus.burst": 12,
					"test.critOnDuble": true,
				}),
			]),
		);
		expect(result.valid).toBe(false);
		// Nothing is silently dropped and NOTHING is imported: the refused key
		// appears in the report, the accepted ones never reach the importer.
		expect(result.profiles).toEqual([]);
		expect(result.problems[0]?.kind).toBe("profile-delta-invalid");
		const problem = result.problems[0];
		expect(problem?.kind === "profile-delta-invalid" && problem.problems).toEqual([
			expect.stringContaining('unknown rule knob "test.critOnDuble"'),
		]);
	});

	test("a wrong-typed knob value is NAMED the same way", () => {
		const result = parseRuleProfilePack(
			pack([entry("lethal", { "test.critOnDouble": "no" })]),
		);
		expect(result.valid).toBe(false);
		const problem = result.problems[0];
		expect(problem?.kind === "profile-delta-invalid" && problem.problems).toEqual([
			expect.stringContaining(
				'"test.critOnDouble" expects a boolean, got the string "no"',
			),
		]);
	});

	test("every control kind round-trips through a pack", () => {
		const delta = {
			"test.critOnDouble": false, // boolean
			"combat.fireModeBonus.burst": 0, // number
			"skills.untrainedSkill.model": "flat-penalty", // select
			"skills.untrainedSkill.penalty": -10,
			"test.autoFailRoll": 96, // nullable number
			"tables.hitLocations": { "86-00": "head" }, // whole-replacement table
		};
		const result = parseRuleProfilePack(pack([entry("lethal", delta)]));
		expect(result.valid).toBe(true);
		expect(result.profiles[0]?.delta).toEqual(delta);
		// ...and resolves to exactly those rules.
		expect(packProfileEffective(result.profiles[0]!).critOnDouble).toBe(false);
	});

	test("a name is optional — the id names the profile", () => {
		const result = parseRuleProfilePack(
			pack([{ id: "lethal", delta: {} }]),
		);
		expect(result.valid).toBe(true);
		expect(result.profiles[0]?.name).toBe("lethal");
		expect(result.profiles[0]?.description).toBeUndefined();
	});

	test("base is optional; a present one keeps profile and systemVersion", () => {
		const withoutBase = parseRuleProfilePack(pack([{ id: "a", delta: {} }]));
		expect(withoutBase.profiles[0]?.base).toBeNull();
		const withBase = parseRuleProfilePack(
			pack([
				{
					id: "a",
					delta: {},
					base: { profile: "rt-core", systemVersion: "1.2.3" },
				},
			]),
		);
		expect(withBase.profiles[0]?.base).toEqual({
			profile: "rt-core",
			systemVersion: "1.2.3",
		});
	});
});

describe("the snapshot is display-only metadata", () => {
	test("a snapshot that disagrees with its delta resolves from the delta", () => {
		const result = parseRuleProfilePack(
			pack([
				{
					id: "silly",
					name: "Silly burst",
					base: { profile: "rt-core", systemVersion: "9.9.9" },
					delta: { "combat.fireModeBonus.burst": 5 },
					// The tempting lie: a frozen copy of the rules that says
					// something else. Nothing may read it.
					snapshot: { fireModeBonus: { burst: 999, full: 777 } },
				},
			]),
		);
		expect(result.valid).toBe(true);
		const profile = result.profiles[0]!;
		// The snapshot rides along untouched...
		expect(profile.snapshot).toEqual({
			fireModeBonus: { burst: 999, full: 777 },
		});
		// ...and the DELTA is what the rules resolve from.
		expect(profile.delta).toEqual({ "combat.fireModeBonus.burst": 5 });
		const effective = packProfileEffective(profile);
		expect(effective.fireModeBonus.burst).toBe(5);
		expect(effective.fireModeBonus.full).toBe(rtCore.fireModeBonus.full);
		// And it is nowhere else: the parsed delta never grew a snapshot key.
		expect(Object.keys(profile.delta)).toEqual(["combat.fireModeBonus.burst"]);
		expect(JSON.stringify(profile.delta)).not.toContain("999");
	});

	test("resolution over an explicit base ignores the snapshot too", () => {
		const result = parseRuleProfilePack(
			pack([
				{
					id: "silly",
					delta: { "test.critOnDouble": false },
					snapshot: { critOnDouble: true },
				},
			]),
		);
		expect(packProfileEffective(result.profiles[0]!, rtCore).critOnDouble).toBe(
			false,
		);
	});
});

describe("export -> import -> export is byte-identical", () => {
	const rows: readonly RuleProfilePackRow[] = [
		{
			id: "lethal",
			name: "Lethal",
			delta: {
				"combat.fireModeBonus.burst": 0,
				"tables.hitLocations": { "86-00": "head", "85-84": "rightArm" },
			},
		},
		{ id: "silly", name: "Silly burst", delta: {} },
	];

	test("all profiles", () => {
		const first = ruleProfilePackJson(rows, BASE);
		const parsed = parseRuleProfilePack(first);
		expect(parsed.valid).toBe(true);
		expect(parsed.profiles).toHaveLength(2);
		const second = ruleProfilePackJson(
			parsed.profiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				description: profile.description,
				base: profile.base,
				delta: profile.delta,
				snapshot: profile.snapshot,
			})),
			BASE,
		);
		expect(second).toBe(first);
	});

	test("the active profile only", () => {
		const first = ruleProfilePackJson([rows[0]!], BASE);
		const parsed = parseRuleProfilePack(first);
		expect(parsed.profiles.map((profile) => profile.id)).toEqual(["lethal"]);
		expect(
			ruleProfilePackJson(
				parsed.profiles.map((profile) => ({
					id: profile.id,
					name: profile.name,
					base: profile.base,
					delta: profile.delta,
				})),
				BASE,
			),
		).toBe(first);
	});

	test("a foreign pack's snapshot and description survive the round trip", () => {
		const first = pack([
			{
				id: "a",
				name: "A",
				description: "House rules for the campaign",
				base: { profile: "rt-core", systemVersion: "1.0.0" },
				delta: { "test.critOnDouble": false },
				snapshot: { critOnDouble: true },
			},
		]);
		const parsed = parseRuleProfilePack(first);
		expect(parsed.valid).toBe(true);
		const second = ruleProfilePackJson(
			parsed.profiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				description: profile.description,
				base: profile.base,
				delta: profile.delta,
				snapshot: profile.snapshot,
			})),
			BASE,
		);
		// Byte-identical text, snapshot included: a re-exported pack loses
		// nothing the GM pasted in.
		expect(JSON.parse(second)).toEqual(JSON.parse(first));
		expect(second).toBe(
			JSON.stringify(
				buildRuleProfilePack(
					[
						{
							id: "a",
							name: "A",
							description: "House rules for the campaign",
							base: { profile: "rt-core", systemVersion: "1.0.0" },
							delta: { "test.critOnDouble": false },
							snapshot: { critOnDouble: true },
						},
					],
					BASE,
				),
				null,
				2,
			),
		);
	});

	test("the built pack's shape is the documented one", () => {
		const built = buildRuleProfilePack([rows[0]!], BASE);
		expect(Object.keys(built)).toEqual(["kind", "schemaVersion", "profiles"]);
		expect(built.kind).toBe(RULE_PROFILE_PACK_KIND);
		expect(built.schemaVersion).toBe(RULE_PROFILE_PACK_SCHEMA_VERSION);
		expect(Object.keys(built.profiles[0]!)).toEqual([
			"id",
			"name",
			"base",
			"delta",
		]);
		expect(built.profiles[0]!.base).toEqual(BASE);
	});

	test("a base with no systemVersion omits the field", () => {
		const built = buildRuleProfilePack([{ id: "a", name: "A", delta: {} }], {
			profile: "rt-core",
		});
		expect(built.profiles[0]!.base).toEqual({ profile: "rt-core" });
		expect(ruleProfilePackJson(built.profiles, { profile: "rt-core" })).not.toContain(
			"systemVersion",
		);
	});
});

describe("refusal sentences carry their parameters", () => {
	test("params are the interpolation set for the localised sentence", () => {
		expect(packProblemParams({ kind: "wrong-kind", got: '"x"', expected: '"y"' })).toEqual(
			{ got: '"x"', expected: '"y"' },
		);
		expect(
			packProblemParams({ kind: "profile-duplicate-id", index: 2, id: "lethal" }),
		).toEqual({ index: "2", id: "lethal" });
		// The delta detail list is not a parameter: it is rendered as rows.
		expect(
			packProblemParams({
				kind: "profile-delta-invalid",
				index: 1,
				id: "a",
				problems: ["x"],
			}),
		).toEqual({ index: "1", id: "a" });
	});
});

// ---------------------------------------------------------------------------
// The kind is SYSTEM-DERIVED (bead w9sa.2)
// ---------------------------------------------------------------------------

/**
 * A FAKE sibling registry, in the shape bead w9sa.3 authors DH2's for real.
 * Its keys share nothing with Rogue Trader's — the inverted fire mode is a
 * PENALTY, there is no push cap, untrained is a flat modifier — so a test that
 * still resolves RT's knobs cannot pass by accident.
 */
const SIBLING_KNOBS: readonly RuleKnob[] = [
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
];
const SIBLING_REGISTRY: RuleKnobRegistry = {
	systemId: "dark-heresy-2e",
	knobs: SIBLING_KNOBS,
};
const SIBLING_KIND = ruleProfilePackKindFor(SIBLING_REGISTRY.systemId);

afterEach(() => {
	resetRuleKnobRegistryForTests();
});

describe("a pack's kind belongs to the system that authored it", () => {
	test("RT's own kind is still derived, and still the same string", () => {
		expect(RULE_PROFILE_PACK_KIND).toBe("rogue-trader.rule-profiles");
		expect(RULE_PROFILE_PACK_KIND).toBe(
			ruleProfilePackKindFor(RT_RULE_KNOB_REGISTRY.systemId),
		);
	});

	test("an RT pack still imports into RT, byte for byte", () => {
		const result = parseRuleProfilePack(
			pack([entry("lethal", { "test.critOnDouble": false })]),
		);
		expect(result.valid).toBe(true);
		expect(result.profiles[0]!.delta).toEqual({ "test.critOnDouble": false });
	});

	test("a SIBLING pack is refused into RT, naming the kind", () => {
		const result = parseRuleProfilePack(
			JSON.stringify({
				kind: SIBLING_KIND,
				schemaVersion: RULE_PROFILE_PACK_SCHEMA_VERSION,
				profiles: [
					{
						id: "standard",
						name: "Standard mode",
						delta: { "combat.standardMode": 10 },
					},
				],
			}),
		);
		expect(result.valid).toBe(false);
		expect(result.problems[0]).toEqual({
			kind: "wrong-kind",
			got: '"dark-heresy-2e.rule-profiles"',
			expected: '"rogue-trader.rule-profiles"',
		});
	});

	test("and vice versa: an RT pack is refused into the sibling world", () => {
		// The registry in force is now the sibling's, so the guard follows it in
		// BOTH directions — the same code, one binding, no per-system branch.
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		expect(SIBLING_KIND).toBe("dark-heresy-2e.rule-profiles");
		const rtPack = parseRuleProfilePack(
			pack([entry("lethal", { "test.critOnDouble": false })]),
		);
		expect(rtPack.valid).toBe(false);
		expect(rtPack.problems[0]).toEqual({
			kind: "wrong-kind",
			got: '"rogue-trader.rule-profiles"',
			expected: '"dark-heresy-2e.rule-profiles"',
		});
		// RT's knob key is UNKNOWN to the sibling registry, so it is named
		// rather than translated into a rule the book does not have.
		const foreign = parseRuleProfilePack(
			JSON.stringify({
				kind: SIBLING_KIND,
				schemaVersion: RULE_PROFILE_PACK_SCHEMA_VERSION,
				profiles: [
					{ id: "s", name: "S", delta: { "combat.fireModeBonus.burst": 0 } },
				],
			}),
		);
		expect(foreign.valid).toBe(false);
		expect(foreign.problems[0]?.kind).toBe("profile-delta-invalid");
		expect(foreign.errors[0]).toContain(
			'unknown rule knob "combat.fireModeBonus.burst"',
		);
	});

	test("an export is stamped with the kind of the system exporting it", () => {
		const rows: readonly RuleProfilePackRow[] = [
			{ id: "s", name: "S", delta: { "combat.standardMode": 10 } },
		];
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		const built = buildRuleProfilePack(rows, { profile: "dh2-core" }, SIBLING_REGISTRY);
		expect(built.kind).toBe("dark-heresy-2e.rule-profiles");
		expect(JSON.parse(ruleProfilePackJson(rows, { profile: "dh2-core" }, SIBLING_REGISTRY)).kind).toBe(
			"dark-heresy-2e.rule-profiles",
		);
		// Parse it back under the same registry: the round trip still closes.
		const parsed = parseRuleProfilePack(
			ruleProfilePackJson(rows, { profile: "dh2-core" }, SIBLING_REGISTRY),
			SIBLING_REGISTRY,
		);
		expect(parsed.valid).toBe(true);
		expect(parsed.profiles[0]!.delta).toEqual({ "combat.standardMode": 10 });
	});

	test("packProfileEffective resolves the delta against the registry given", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		// The sibling's own knob key merges without the caller naming its
		// registry — the ACTIVE one is the one in force.
		expect(
			packProfileEffective({ delta: { "combat.standardMode": -10 } }).fireModeBonus
				.burst,
		).toBe(-10);
		// ...and an RT key is thrown out by NAME, never silently applied.
		expect(() =>
			packProfileEffective({ delta: { "combat.fireModeBonus.burst": 0 } }),
		).toThrow(/unknown rule knob "combat.fireModeBonus.burst"/);
	});
});
