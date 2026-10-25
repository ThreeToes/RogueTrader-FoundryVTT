/**
 * Dark Heresy 2e's rule-knob registry (epic w9sa, child D3).
 *
 * The registry is pure data, so this file is the bead's gate: no Foundry, no
 * ports, no settings seam. Four things are pinned here —
 *
 *   1. PROVENANCE — every entry's `coreValue` is READ from the `dh2Core` field
 *      its `path` addresses, and the citation table below lists each one with
 *      the printed page it came from. A value the book does not give is a loud
 *      hole, never a default.
 *   2. THE PURE PAIR — RT's `validateProfile` / `mergeProfile` (the seam bead
 *      w9sa.2 parameterised) work UNCHANGED against DH2's registry, including
 *      naming the keys each side does not know.
 *   3. THE ABSENCES — RT's push-cap shape, RT's fire-mode bonuses, RT's elite
 *      base cost and a single-shot fire mode are pinned ABSENT, so adding one
 *      later is a deliberate edit that has to delete a test.
 *   4. THE i18n SURFACE — every knob's label/hint lives under DH2's OWN prefix
 *      (`RULES.DH.*`, bead w9sa.11) and exists, translated, in all four
 *      language files. Exactly three knob IDS are shared with RT because they
 *      name the same rule in both books; only those three co-own one
 *      book-neutral label key (see the `shared` pin).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";

import {
	DARK_HERESY_RULE_KNOBS,
	DARK_HERESY_RULE_KNOB_REGISTRY,
	DH2_KNOB_I18N_PREFIX,
	DH2_SYSTEM_ID,
} from "./rule-knobs-dark-heresy";
import {
	findKnob,
	hintKeyFor,
	knobLabelNamespace,
	knobsInGroup,
	labelKeyFor,
	mergeProfile,
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
	ruleKnobKeys,
	ruleKnobRegistry,
	ruleKnobs,
	ruleProfilePackKindFor,
	RULE_KNOBS as RT_KNOBS,
	RULE_KNOBS_EXCLUDED_KEYS,
	type RuleKnob,
	validateProfile,
} from "./rule-knobs";
import {
	DH2_ADVANCE_COST_COLUMNS,
	DH2_ADVANCE_TIERS,
	DH2_CHARACTERISTIC_ADVANCE_COST,
	dh2Core,
} from "./system-profile-dark-heresy";

/** Read the value a knob's path points at on a profile. */
function readAt(source: unknown, path: readonly string[]): unknown {
	let cursor = source;
	for (const segment of path) {
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/** The knob named in this registry, or the test fails naming it. */
function knobByKey(key: string): RuleKnob {
	const knob = findKnob(DARK_HERESY_RULE_KNOBS, key);
	expect(knob, `missing DH2 knob ${key}`).toBeDefined();
	if (!knob) throw new Error(`missing DH2 knob ${key}`);
	return knob;
}

/** Every key the DH2 registry owns, in display order. */
const INVENTORY: readonly string[] = [
	// test
	"test.critOnDouble",
	"test.automaticFailureRoll",
	"test.automaticSuccessRoll",
	// damage
	"damage.primitiveArmourDouble",
	"damage.righteousFury",
	"damage.degreesReplaceOneDie",
	// combat
	"combat.standardAttackBonus",
	"combat.fullAutoBurstPenalty",
	"combat.semiAutoBurstModifier",
	// psychic
	"psychic.pushCap.bound",
	"psychic.pushCap.daemonic",
	"psychic.pushCap.unbound",
	// creation
	"creation.generationDice",
	"creation.generationBonus",
	"creation.xpBudget",
	// advancement — Table 2-2, printed p80, in tier then aptitude order
	"advancement.characteristicCost.simple.two",
	"advancement.characteristicCost.simple.one",
	"advancement.characteristicCost.simple.zero",
	"advancement.characteristicCost.intermediate.two",
	"advancement.characteristicCost.intermediate.one",
	"advancement.characteristicCost.intermediate.zero",
	"advancement.characteristicCost.trained.two",
	"advancement.characteristicCost.trained.one",
	"advancement.characteristicCost.trained.zero",
	"advancement.characteristicCost.proficient.two",
	"advancement.characteristicCost.proficient.one",
	"advancement.characteristicCost.proficient.zero",
	"advancement.characteristicCost.expert.two",
	"advancement.characteristicCost.expert.one",
	"advancement.characteristicCost.expert.zero",
];

/** The knob ids this book shares with RT because they name the same rule. */
const SHARED_KNOB_IDS: readonly string[] = [
	"test.critOnDouble",
	"damage.primitiveArmourDouble",
	"damage.righteousFury",
];

describe("DH2's rule-knob registry", () => {
	test("the inventory is exactly the bead's knob list, with no duplicates", () => {
		expect(DARK_HERESY_RULE_KNOBS.map((knob) => knob.key)).toEqual(INVENTORY);
		expect(new Set(INVENTORY).size).toBe(INVENTORY.length);
	});

	test("every entry is well formed: group matches the key, control is known", () => {
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			expect(knob.key.split(".")[0], `${knob.key} group`).toBe(knob.group);
			expect(knob.path.length, `${knob.key} path`).toBeGreaterThan(0);
			expect(["number", "boolean", "select", "table"]).toContain(knob.control);
			expect([
				"auto-recomputed",
				"creation-only",
				"ledger-assuming",
			]).toContain(knob.hazard);
			// DH2e has no enumerated choice to tune: every entry is a number or
			// a boolean, so no entry may carry select-only `options`.
			expect(knob.options, `${knob.key} options`).toBeUndefined();
		}
		// Every section the registry names is populated.
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			expect(
				knobsInGroup(DARK_HERESY_RULE_KNOBS, knob.group).length,
				`${knob.group} section`,
			).toBeGreaterThan(0);
		}
	});

	test("hazard classes are the scoped ones", () => {
		const keysWith = (hazard: RuleKnob["hazard"]): string[] =>
			DARK_HERESY_RULE_KNOBS.filter((knob) => knob.hazard === hazard).map(
				(knob) => knob.key,
			);
		// The Table 2-2 cells price advances, so changing one makes every
		// existing character's spent-xp ledger wrong.
		expect(keysWith("ledger-assuming")).toEqual(
			INVENTORY.filter((key) => key.startsWith("advancement.")),
		);
		expect(keysWith("creation-only")).toEqual([
			"creation.generationDice",
			"creation.generationBonus",
			"creation.xpBudget",
		]);
		// Everything else is auto-recomputed for characters that already exist.
		expect(keysWith("auto-recomputed")).toHaveLength(
			INVENTORY.length - 15 - 3,
		);
	});

	test("the registry holds no system-identity or extension-point key", () => {
		for (const excluded of RULE_KNOBS_EXCLUDED_KEYS) {
			expect(INVENTORY, `${excluded} key must stay out`).not.toContain(excluded);
			const paths = DARK_HERESY_RULE_KNOBS.map((knob) => knob.path.join("."));
			expect(paths, `${excluded} path must stay out`).not.toContain(excluded);
		}
		// The home-world extension points are the ones a sibling system could
		// most easily mistake for system-wide rules.
		expect(
			DARK_HERESY_RULE_KNOBS.some((knob) =>
				knob.path.join(".").startsWith("startingWounds"),
			),
		).toBe(false);
		expect(
			DARK_HERESY_RULE_KNOBS.some((knob) =>
				knob.path.join(".").startsWith("startingFate"),
			),
		).toBe(false);
	});

	test("every coreValue is READ from the dh2Core field the knob claims", () => {
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			const trail = knob.path.map((segment) => `.${segment}`).join("");
			expect(
				knob.coreValue,
				`${knob.key} coreValue must be dh2Core${trail}`,
			).toEqual(readAt(dh2Core, knob.path));
			// A knob whose value the profile does not carry would read as
			// `undefined`, which is exactly the silent default this bead refuses.
			expect(knob.coreValue, `${knob.key} must carry a book value`).not.toBe(
				undefined,
			);
		}
	});

	/**
	 * The citation table: knob key -> the book's value -> where it is printed.
	 * Every entry is listed, so a knob that loses its citation fails here.
	 */
	const CITATIONS: ReadonlyArray<[string, number | boolean, string]> = [
		[
			"test.critOnDouble",
			false,
			"printed p22 (file 23): the Core Mechanic's only special cases are 1 and 100; a double is not a Critical (Criticals come from damage, printed p232)",
		],
		["test.automaticFailureRoll", 100, "printed p22: a roll of 100 always fails"],
		["test.automaticSuccessRoll", 1, "printed p22: a roll of 1 always succeeds"],
		[
			"damage.primitiveArmourDouble",
			false,
			"printed p148, p168, p227: Primitive (X) is a WEAPON quality and Step Five subtracts Toughness bonus plus Armour points only",
		],
		[
			"damage.righteousFury",
			true,
			"printed p227: a natural 10 on any damage die triggers Righteous Fury",
		],
		[
			"damage.degreesReplaceOneDie",
			true,
			"printed p227: the attacker may replace one damage die with the degrees of success",
		],
		["combat.standardAttackBonus", 10, "printed p226: a Standard Attack is +10"],
		[
			"combat.fullAutoBurstPenalty",
			-10,
			"printed p226: a Full Auto Burst imposes -10 on the BS test",
		],
		[
			"combat.semiAutoBurstModifier",
			0,
			"printed p223: a Semi-Auto Burst is a Challenging (+0) BS test",
		],
		[
			"psychic.pushCap.bound",
			2,
			"Table 6-1, printed p195: a Bound psyker pushes up to +2 PR",
		],
		[
			"psychic.pushCap.daemonic",
			3,
			"Table 6-1, printed p195: a Daemonic psyker pushes up to +3 PR",
		],
		[
			"psychic.pushCap.unbound",
			4,
			"Table 6-1, printed p195: an Unbound psyker pushes up to +4 PR",
		],
		["creation.generationDice", 2, "printed p31: roll 2d10 per characteristic"],
		["creation.generationBonus", 20, "printed p31: add 20 to each roll"],
		[
			"creation.xpBudget",
			1000,
			"printed p78: 1,000 xp to SPEND at character creation, none pre-spent",
		],
		...DH2_ADVANCE_TIERS.flatMap((tier) =>
			DH2_ADVANCE_COST_COLUMNS.map(
				(aptitudes) =>
					[
						`advancement.characteristicCost.${tier}.${aptitudes}`,
						DH2_CHARACTERISTIC_ADVANCE_COST[tier][aptitudes],
						`Table 2-2, printed p80: ${tier} advance costing ${aptitudes} shared aptitudes`,
					] as [string, number, string],
			),
		),
	];

	test("the citation table: every entry's value is the book's, with its page", () => {
		expect(CITATIONS).toHaveLength(DARK_HERESY_RULE_KNOBS.length);
		for (const [key, value, citation] of CITATIONS) {
			expect(
				knobByKey(key).coreValue,
				`${key} — ${citation}`,
			).toBe(value);
		}
	});

	test("labelKey/hintKey are the documented derivation, under DH2's own prefix", () => {
		const KEY_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+$/;
		// Bead w9sa.11: DH2's labels live under RULES.DH.*, never in RT's flat
		// RULES.* family — except the three deliberately co-owned, book-neutral
		// rules, which keep RT's key (pinned by the `shared` test below).
		expect(DH2_KNOB_I18N_PREFIX).toBe("dh");
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			expect(knob.labelKey).toMatch(KEY_SHAPE);
			expect(knob.hintKey).toMatch(KEY_SHAPE);
			if (SHARED_KNOB_IDS.includes(knob.key)) {
				// Co-owned with RT (see the `shared` test): RT's book-neutral key.
				expect(knob.labelKey, knob.key).toBe(labelKeyFor(knob.key));
				expect(knob.hintKey, knob.key).toBe(hintKeyFor(knob.key));
				continue;
			}
			expect(knob.labelKey, knob.key).toBe(
				labelKeyFor(knob.key, DH2_KNOB_I18N_PREFIX),
			);
			expect(knob.hintKey, knob.key).toBe(
				hintKeyFor(knob.key, DH2_KNOB_I18N_PREFIX),
			);
			expect(
				knob.labelKey.startsWith(knobLabelNamespace(DH2_KNOB_I18N_PREFIX)),
				`${knob.labelKey} must live under DH2's prefix`,
			).toBe(true);
		}
	});

	test("every knob's label and hint exist in all four language files", () => {
		const LANGS = ["en", "es", "fr", "pl"] as const;
		const dictionaries = Object.fromEntries(
			LANGS.map((lang) => [
				lang,
				JSON.parse(readFileSync(`lang/${lang}.json`, "utf8")) as Record<
					string,
					string
				>,
			]),
		) as Record<(typeof LANGS)[number], Record<string, string>>;
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			for (const lang of LANGS) {
				for (const key of [knob.labelKey, knob.hintKey]) {
					expect(
						dictionaries[lang][key],
						`${lang}.json must translate ${key} (${knob.key})`,
					).toBeTruthy();
				}
			}
		}
	});

	test("exactly three knob IDS are SHARED with RT's registry, each book-neutral", () => {
		// A shared knob ID is allowed only when it names the SAME rule in both
		// books; for those three the wording is book-neutral too, so the two
		// systems CO-OWN one label key instead of duplicating the translation.
		// Any other overlap is a no-sibling-names guard failure (bead w9sa.11)
		// rather than something this test has to notice.
		const shared = INVENTORY.filter((key) => findKnob(RT_KNOBS, key) !== undefined);
		expect(shared).toEqual(SHARED_KNOB_IDS);
		// The three entries really do carry RT's co-owned keys, not look-alikes,
		// and each is the same rule SHAPE on both sides (group, control, path).
		for (const key of SHARED_KNOB_IDS) {
			const mine = knobByKey(key);
			const theirs = findKnob(RT_KNOBS, key);
			expect(mine.labelKey).toBe(labelKeyFor(key));
			expect(mine.hintKey).toBe(hintKeyFor(key));
			expect(mine.labelKey).toBe(theirs?.labelKey);
			expect(mine.group).toBe(theirs?.group);
			expect(mine.control).toBe(theirs?.control);
			expect(mine.path).toEqual(theirs?.path);
		}
		// Every other DH2 label is DH2's own, so the namespaces cannot collide.
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			if (SHARED_KNOB_IDS.includes(knob.key)) continue;
			expect(
				knob.labelKey.startsWith(knobLabelNamespace(DH2_KNOB_I18N_PREFIX)),
				`${knob.labelKey} must live under DH2's prefix`,
			).toBe(true);
		}
	});
});

describe("entries deliberately ABSENT from DH2's registry", () => {
	test("RT's psychic push shape is unknown here (DH2 keys on psykER type)", () => {
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "psychic.pushCap.sanctioned"),
		).toBeUndefined();
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "psychic.pushCap.other"),
		).toBeUndefined();
		// RT keeps its own: the absence is DH2's, not a global removal.
		expect(findKnob(RT_KNOBS, "psychic.pushCap.sanctioned")).toBeDefined();
		expect(findKnob(RT_KNOBS, "psychic.pushCap.other")).toBeDefined();
		// DH2's caps live on its own field, keyed bound/daemonic/unbound.
		expect(knobByKey("psychic.pushCap.bound").path).toEqual([
			"psychicPush",
			"caps",
			"bound",
		]);
	});

	test("RT's fire-mode BONUSES are unknown here (DH2 signs its own)", () => {
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "combat.fireModeBonus.burst"),
		).toBeUndefined();
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "combat.fireModeBonus.full"),
		).toBeUndefined();
		// The sign inversion is the reason: RT's burst is +10 and DH2's Full
		// Auto is -10, so the two fields must never be read through each other.
		expect(findKnob(RT_KNOBS, "combat.fireModeBonus.burst")?.coreValue).toBe(10);
		expect(knobByKey("combat.fullAutoBurstPenalty").coreValue).toBe(-10);
		expect(knobByKey("combat.standardAttackBonus").path).toEqual([
			"fireModes",
			"standard",
			"modifier",
		]);
	});

	test("RT's elite-advance BASE cost is unknown here (DH2 is per-advance)", () => {
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "advancement.eliteAdvanceBaseCost"),
		).toBeUndefined();
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "creation.eliteAdvanceBaseCost"),
		).toBeUndefined();
		// Printed pp88-91: each elite advance carries its OWN Experience Cost
		// (Inquisitor 1,000 / Psyker 300 / Untouchable 300), so the profile
		// records the kernel union's per-advance member rather than a number to
		// tune (bead cmio.2 renamed the shared field to `eliteAdvanceCost`).
		expect(dh2Core.eliteAdvanceCost).toEqual({ model: "per-advance" });
		expect(findKnob(RT_KNOBS, "advancement.eliteAdvanceBaseCost")?.coreValue).toBe(
			500,
		);
	});

	test("there is no single-shot fire mode: a single shot IS the Standard Attack", () => {
		for (const key of INVENTORY) {
			expect(key, "no single-shot knob may exist").not.toContain("singleShot");
		}
		// The profile must not grow the field either (printed p223).
		expect("singleShot" in dh2Core.fireModes).toBe(false);
	});

	test("wounds and fate per home world are NOT knobs: no system-wide value", () => {
		// Printed pp32-43: the flat wounds (Feral 9 … Voidborn 7) and the fate
		// threshold are PER-HOME-WORLD data. A single knob would have to invent
		// a system-wide default, which is exactly what the repo forbids, so the
		// core profile carries none and the registry registers none.
		expect(dh2Core.startingWounds).toEqual({
			model: "flat-plus-dice",
			flat: 0,
			dice: "1d5",
		});
		// The constant 1d5 layer is a DICE string, not a number, so it is not
		// expressible as a number knob either.
		expect(dh2Core.startingFate).toEqual({
			model: "threshold",
			emperorBlessing: true,
		});
		expect(
			DARK_HERESY_RULE_KNOBS.filter((knob) => knob.group === "creation").map(
				(knob) => knob.key,
			),
		).toEqual([
			"creation.generationDice",
			"creation.generationBonus",
			"creation.xpBudget",
		]);
	});

	test("RT's own untrained-skill knobs are unknown here (DH2 is flat -20)", () => {
		// Bead cmio.2: the old `skills.untrainedPenalty` knob was DELETED with
		// the collapse — DH2e's flat penalty is the kernel UntrainedSkill
		// union's flat-penalty member on `dh2Core.untrainedSkill`, and neither
		// RT's model-select keys nor a DH2 skills knob exists here. A stored
		// DH2 delta still carrying the deleted key is refused BY NAME.
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "skills.untrainedPenalty"),
		).toBeUndefined();
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "skills.untrainedSkill.model"),
		).toBeUndefined();
		expect(
			findKnob(DARK_HERESY_RULE_KNOBS, "skills.untrainedSkill.penalty"),
		).toBeUndefined();
		expect(dh2Core.untrainedSkill).toEqual({
			model: "flat-penalty",
			penalty: -20,
		});
	});
});

describe("validateProfile / mergeProfile work unchanged against DH2", () => {
	test("a core-value delta for every knob validates", () => {
		const core: Record<string, unknown> = {};
		for (const knob of DARK_HERESY_RULE_KNOBS) core[knob.key] = knob.coreValue;
		const result = validateProfile(DARK_HERESY_RULE_KNOBS, core);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
		expect(result.value).toEqual(core);
	});

	test("an RT knob key is UNKNOWN to the DH2 registry — named, not dropped", () => {
		const result = validateProfile(DARK_HERESY_RULE_KNOBS, {
			"combat.standardAttackBonus": 0,
			"combat.fireModeBonus.burst": 0,
		});
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("combat.fireModeBonus.burst");
		expect(result.errors[0]).toContain("rejected");
		expect(result.value).toEqual({ "combat.standardAttackBonus": 0 });
	});

	test("a DH2 knob key is unknown to RT's registry — named, not dropped", () => {
		const result = validateProfile(RT_KNOBS, {
			"combat.fullAutoBurstPenalty": -10,
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("combat.fullAutoBurstPenalty");
		expect(result.value).toEqual({});
	});

	test("wrong control types fail, naming the key", () => {
		const bad: Array<[Record<string, unknown>, string]> = [
			[{ "test.critOnDouble": "true" }, "test.critOnDouble"],
			[{ "combat.standardAttackBonus": "+10" }, "combat.standardAttackBonus"],
			[
				{ "advancement.characteristicCost.expert.zero": Number.NaN },
				"advancement.characteristicCost.expert.zero",
			],
			[{ "damage.degreesReplaceOneDie": 1 }, "damage.degreesReplaceOneDie"],
		];
		for (const [delta, key] of bad) {
			const result = validateProfile(DARK_HERESY_RULE_KNOBS, delta);
			expect(result.valid, key).toBe(false);
			expect(result.errors[0], key).toContain(key);
			expect(result.value, key).toEqual({});
		}
	});

	test("the printed bands cannot be nulled (they are values, not absences)", () => {
		// RT's bands are null because the RT Core Rulebook prints none, so they
		// are nullable there. DH2e PRINTS both, so null is an error here.
		expect(
			validateProfile(DARK_HERESY_RULE_KNOBS, {
				"test.automaticFailureRoll": null,
			}).valid,
		).toBe(false);
		expect(
			validateProfile(DARK_HERESY_RULE_KNOBS, {
				"test.automaticSuccessRoll": null,
			}).valid,
		).toBe(false);
		expect(
			validateProfile(DARK_HERESY_RULE_KNOBS, {
				"test.automaticFailureRoll": 96,
			}).valid,
		).toBe(true);
	});

	test("mergeProfile layers a DH2 delta over dh2Core, leaf-merging", () => {
		const merged = mergeProfile(
			dh2Core,
			{
				"combat.standardAttackBonus": 0,
				"creation.xpBudget": 500,
				"advancement.characteristicCost.expert.zero": 500,
			},
			DARK_HERESY_RULE_KNOBS,
		);
		// The written leaves are the delta's.
		expect(merged.fireModes.standard.modifier).toBe(0);
		expect(merged.creationXpEconomics.granted).toBe(500);
		expect(merged.characteristicAdvanceCost.expert.zero).toBe(500);
		// Sibling leaves of the same containers stay at core — so a GM tuning
		// one tier does not have to restate the rest of the matrix.
		expect(merged.fireModes.fullAutoBurst.modifier).toBe(-10);
		expect(merged.fireModes.semiAutoBurst.modifier).toBe(0);
		expect(merged.characteristicAdvanceCost.expert.one).toBe(1500);
		expect(merged.characteristicAdvanceCost.simple.two).toBe(100);
		expect(merged.psychicPush.caps).toEqual(dh2Core.psychicPush.caps);
		// Untouched fields are carried through.
		expect(merged.id).toBe("dh2-core");
		expect(merged.untrainedSkill).toEqual({
			model: "flat-penalty",
			penalty: -20,
		});
		expect(merged.eliteAdvanceCost).toEqual({ model: "per-advance" });
	});

	test("dh2Core is never mutated and never aliases the delta", () => {
		const delta = { "creation.generationDice": 3 };
		mergeProfile(dh2Core, delta, DARK_HERESY_RULE_KNOBS);
		expect(dh2Core.generation).toEqual({
			model: "roll",
			dice: 2,
			bonus: 20,
			formula: "2d10+20",
			modifierPerRoll: 0,
		});
		expect(dh2Core.characteristicAdvanceCost).toBe(
			DH2_CHARACTERISTIC_ADVANCE_COST,
		);
		expect(delta).toEqual({ "creation.generationDice": 3 });
	});

	test("an RT key is unknown to DH2's registry and the error NAMES it", () => {
		expect(() =>
			mergeProfile(
				dh2Core,
				{ "psychic.pushCap.sanctioned": 1 },
				DARK_HERESY_RULE_KNOBS,
			),
		).toThrow(/psychic\.pushCap\.sanctioned/);
		// ...and the error names the keys this registry DOES know.
		expect(() =>
			mergeProfile(dh2Core, { nope: 1 }, DARK_HERESY_RULE_KNOBS),
		).toThrow(/psychic\.pushCap\.bound/);
	});
});

describe("the registry is RT's until DH2's is registered", () => {
	// The binding is module-global and bun runs every suite in ONE process, so
	// a leaked registry would quietly retune the RT suites that run later.
	afterEach(() => {
		resetRuleKnobRegistryForTests();
	});

	test("the default binding is still Rogue Trader's own registry", () => {
		expect(ruleKnobRegistry().systemId).toBe("rogue-trader");
		expect(ruleKnobs()).toBe(RT_KNOBS);
		expect(ruleKnobKeys()[0]).toBe("test.critOnDouble");
		expect(ruleKnobKeys()).not.toEqual(INVENTORY);
	});

	test("registering DH2 swaps the binding, and the API follows it", () => {
		registerRuleKnobRegistry(DARK_HERESY_RULE_KNOB_REGISTRY);
		expect(ruleKnobRegistry().systemId).toBe(DH2_SYSTEM_ID);
		expect(ruleKnobs()).toBe(DARK_HERESY_RULE_KNOBS);
		expect(ruleKnobKeys()).toEqual(INVENTORY);
		expect(findKnob(ruleKnobs(), "combat.fireModeBonus.burst")).toBeUndefined();
		expect(findKnob(ruleKnobs(), "combat.standardAttackBonus")?.control).toBe(
			"number",
		);
		// The merge follows the swap too: RT's key is now the unknown one.
		expect(() =>
			mergeProfile(dh2Core, { "combat.fireModeBonus.burst": 0 }),
		).toThrow(/combat\.standardAttackBonus/);
	});

	test("the rules-pack kind is DERIVED from the system id, per system", () => {
		expect(DARK_HERESY_RULE_KNOB_REGISTRY.systemId).toBe("dark-heresy-2e");
		expect(
			ruleProfilePackKindFor(DARK_HERESY_RULE_KNOB_REGISTRY.systemId),
		).toBe("dark-heresy-2e.rule-profiles");
		expect(
			ruleProfilePackKindFor("dark-heresy-2e"),
		).not.toBe(ruleProfilePackKindFor("rogue-trader"));
	});
});

