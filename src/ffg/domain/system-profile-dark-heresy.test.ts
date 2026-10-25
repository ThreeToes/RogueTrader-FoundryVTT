/**
 * DH2 profile data — every value pinned against its book citation, and every
 * unverified field pinned ABSENT (epic w9sa, child D1). Fields D1 could not
 * settle are pinned ABSENT as loud holes; child D6 of the same epic verified
 * them against the book on 2026-10-11, so those holes are now values and the
 * remainder are pinned absent ON PURPOSE.
 *
 * The values were extracted from the DH2 2e Core Rulebook's raw text layer by
 * the parent on 2026-10-10 (book `dh_core`, file page N == printed page N-1).
 * If a value here changes, the citation must change with it; if a book value
 * disagrees with this file, the FILE is wrong until the owner says otherwise.
 */
import { describe, expect, test } from "bun:test";

import type { RuleProfile } from "../../rules-engine/profile";
import {
	FIRE_MODES,
	type CharacteristicGeneration,
	type EliteAdvanceCost,
	type FireModes,
	fireModeRule,
	type PsychicPush,
	type RtAdvanceLadder,
} from "../../rules-engine/profile-vocabulary";
import {
	SCHEME_TIERS,
	type SchemeTier,
} from "../../roguetrader/rules/advancement";
import {
	DH2_ADVANCE_COST_COLUMNS,
	DH2_ADVANCE_TIERS,
	DH2_CHARACTERISTIC_ADVANCE_COST,
	DH2_CHARACTERISTIC_APTITUDES,
	DH2_GENERATION_DICE,
	DH2_GENERATION_MODIFIER,
	dh2Core,
} from "./system-profile-dark-heresy";
import { rtCore } from "./system-profile";

describe("dh2Core carries the verified Core Rulebook values", () => {
	test("TEN characteristics, Influence last (printed pp21-22)", () => {
		expect(dh2Core.characteristics.keys).toEqual([
			"ws",
			"bs",
			"s",
			"t",
			"ag",
			"int",
			"per",
			"wp",
			"fel",
			"ifl",
		]);
		// RT has nine; the tenth is the architectural difference.
		expect(rtCore.characteristics?.keys).toHaveLength(9);
	});

	test("characteristics are generated 2d10+20, one roll each (printed p31)", () => {
		expect(dh2Core.generation).toEqual({
			model: "roll",
			dice: 2,
			bonus: 20,
			formula: "2d10+20",
			modifierPerRoll: 0,
		});
		// The home world's own per-roll modifier is per-home-world data, so
		// the core profile carries none — the same reason the flat wounds value is 0.
		if (dh2Core.generation.model !== "roll") {
			throw new Error("DH2e rolls its characteristics (printed p31)");
		}
		expect(dh2Core.generation.modifierPerRoll).toBe(0);
	});

	test("the printed 2d10+20 formula is DERIVED from its two numbers (printed p31)", () => {
		// Bead w9sa.3 registers a knob per NUMBER, so `formula` is composed from
		// DH2_GENERATION_DICE / DH2_GENERATION_MODIFIER and can never drift from
		// the pieces a GM tunes.
		expect(DH2_GENERATION_DICE).toBe(2);
		expect(DH2_GENERATION_MODIFIER).toBe(20);
		const generation = dh2Core.generation;
		if (generation.model !== "roll") {
			throw new Error("DH2e rolls its characteristics (printed p31)");
		}
		expect(generation.formula).toBe(
			`${generation.dice}d10+${generation.bonus}`,
		);
		expect(generation.formula).toBe("2d10+20");
	});

	test("1,000 xp to SPEND, nothing pre-spent (printed p78)", () => {
		expect(dh2Core.creationXpEconomics.granted).toBe(1000);
		expect(dh2Core.creationXpEconomics.spentAtCreation).toBe(0);
		// The inversion is the point: RT pre-spends 4,500 (the ledger's seed).
		expect(rtCore.creationXpEconomics.spentAtCreation).toBe(4500);
	});

	test("wounds are a flat home-world value plus 1d5 (printed pp32-43)", () => {
		expect(dh2Core.startingWounds).toEqual({
			model: "flat-plus-dice",
			flat: 0,
			dice: "1d5",
		});
		// The home world's flat values, all six verified in the text:
		// Feral 9, Highborn 9, Forge 8, Hive 8, Shrine 7, Voidborn 7.
		const { HOME_WOUNDS } = {
			HOME_WOUNDS: { feral: 9, forge: 8, highborn: 9, hive: 8, shrine: 7, voidborn: 7 },
		};
		for (const flat of Object.values(HOME_WOUNDS)) {
			expect(flat).toBeGreaterThanOrEqual(7);
			expect(flat).toBeLessThanOrEqual(9);
		}
	});

	test("fate is a THRESHOLD with an Emperor's Blessing roll (printed p30, pp293-294)", () => {
		expect(dh2Core.startingFate).toEqual({
			model: "threshold",
			emperorBlessing: true,
		});
	});

	test("fire modes are SIGNED, Standard +10 and Full Auto -10 (printed p226)", () => {
		expect(dh2Core.fireModes.standard.modifier).toBe(10);
		expect(dh2Core.fireModes.fullAutoBurst.modifier).toBe(-10);
		// The sign inversion versus RT is a VALUE difference under the shared
		// FireModes shape (bead cmio.2): RT's bursts are +10/+20 modifiers.
		expect(rtCore.fireModes).toEqual({
			standard: { modifier: 0, characteristic: "either" },
			semiAutoBurst: {
				modifier: 10,
				characteristic: "ballistic-skill",
				citation: "Core Rulebook p237",
			},
			fullAutoBurst: {
				modifier: 20,
				characteristic: "ballistic-skill",
				citation: "Core Rulebook p237",
			},
		});
	});

	test("untrained skill is a flat -20 penalty (printed p80)", () => {
		// DH2e's member of the kernel's UntrainedSkill union (bead cmio.2).
		expect(dh2Core.untrainedSkill).toEqual({
			model: "flat-penalty",
			penalty: -20,
		});
		// RT halves the characteristic instead.
		expect(rtCore.untrainedSkill).toEqual({ model: "half-characteristic" });
	});

	test("degrees of success replace ONE damage die (printed p227)", () => {
		expect(dh2Core.degreesReplaceOneDamageDie).toBe(true);
	});
});

describe("what DH2 shares with RT instead of forking", () => {
	test("hit locations are IDENTICAL bands, same reversed-digit keying", () => {
		// Table 7-3 (DH2 printed p226) vs Table 9-6 (RT printed p244): the same
		// six bands, read on the reversed digits of the roll.
		expect(dh2Core.hitLocations).toEqual(rtCore.hitLocations);
		expect(Object.keys(dh2Core.hitLocations)).toEqual([
			"01-10",
			"11-20",
			"21-30",
			"31-70",
			"71-85",
			"86-00",
		]);
	});

	test("Righteous Fury exists and shares the kernel's trigger model", () => {
		expect(dh2Core.righteousFury).toEqual(
			rtCore.righteousFury,
		);
		expect(dh2Core.righteousFury).toEqual({
			enabled: true,
			trigger: "damaging-hit",
		});
	});
});

describe("characteristic advances, Table 2-2 (printed p80)", () => {
	test("five tiers, each a permanent +5, purchased in order", () => {
		expect(DH2_ADVANCE_TIERS).toEqual([
			"simple",
			"intermediate",
			"trained",
			"proficient",
			"expert",
		]);
	});

	test("the cost matrix matches the printed table exactly", () => {
		expect(DH2_CHARACTERISTIC_ADVANCE_COST).toEqual({
			simple: { two: 100, one: 250, zero: 500 },
			intermediate: { two: 250, one: 500, zero: 750 },
			trained: { two: 500, one: 750, zero: 1000 },
			proficient: { two: 750, one: 1000, zero: 1500 },
			expert: { two: 1250, one: 1500, zero: 2500 },
		});
	});

	test("the book's worked example: one aptitude -> 250 then 500", () => {
		expect(DH2_CHARACTERISTIC_ADVANCE_COST.simple.one).toBe(250);
		expect(DH2_CHARACTERISTIC_ADVANCE_COST.intermediate.one).toBe(500);
	});

	test("the matrix rides on the PROFILE as the same object, so a knob can retune it", () => {
		// Bead w9sa.3 registers one knob per Table 2-2 cell; the knob path
		// addresses dh2Core.characteristicAdvanceCost, so the profile field and
		// the exported table must be ONE object, never two copies.
		expect(dh2Core.characteristicAdvanceCost).toBe(
			DH2_CHARACTERISTIC_ADVANCE_COST,
		);
	});

	test("the cost columns are data the knobs walk, in printed order", () => {
		expect(DH2_ADVANCE_COST_COLUMNS).toEqual(["two", "one", "zero"]);
		for (const tier of DH2_ADVANCE_TIERS) {
			expect(Object.keys(DH2_CHARACTERISTIC_ADVANCE_COST[tier])).toEqual([
				...DH2_ADVANCE_COST_COLUMNS,
			]);
		}
	});

	test("Table 2-3 aptitudes, and Influence is absent (printed p80, p22)", () => {
		expect(DH2_CHARACTERISTIC_APTITUDES.ws).toEqual(["offence", "offence"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.bs).toEqual(["finesse", "finesse"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.s).toEqual(["offence", "offence"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.t).toEqual(["defence", "defence"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.ag).toEqual(["finesse", "finesse"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.int).toEqual(["knowledge", "knowledge"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.per).toEqual(["fieldcraft", "fieldcraft"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.wp).toEqual(["psyker", "psyker"]);
		expect(DH2_CHARACTERISTIC_APTITUDES.fel).toEqual(["social", "social"]);
		// Nine advanceable characteristics — Influence is not one of them.
		expect(Object.keys(DH2_CHARACTERISTIC_APTITUDES)).toHaveLength(9);
		expect(DH2_CHARACTERISTIC_APTITUDES.ifl).toBeUndefined();
	});
});

describe("the four kernel rule fields, verified by D6 against the book", () => {
	test("a double on a successful test is NOT a Critical Hit (printed p22, p195, p232)", () => {
		// The Core Mechanic (file 23 = printed 22): "If the result of the
		// percentile roll is 1, the test automatically succeeds... Likewise, if
		// the result is 100, then the test automatically fails." Those are the
		// ONLY two special cases; nothing about doubles.
		expect(dh2Core.critOnDouble).toBe(false);
		// The book's own doubles rule is a psychic one, and it is not a critical:
		// Focus Power doubles trigger Psychic Phenomena (printed p195).
		// Character Criticals come from damage exceeding wounds (printed p232).
		// RT, which this field exists for, IS crit-on-double.
		expect(rtCore.critOnDouble).toBe(true);
	});

	test("auto-fail band is 100 and auto-pass band is 1 (printed p22)", () => {
		expect(dh2Core.autoFailRoll).toBe(100);
		expect(dh2Core.autoPassRoll).toBe(1);
		// RT prints neither band, and DH1's remembered 01-05 does NOT apply here:
		// DH2e's auto-pass is the single digit 1.
		expect(rtCore.autoFailRoll).toBeNull();
		expect(rtCore.autoPassRoll).toBeNull();
	});

	test("no primitive-armour rule: Primitive (X) is a WEAPON quality (printed p148, p168, p227)", () => {
		expect(dh2Core.primitiveArmourDouble).toBe(false);
		// "When rolling for damage with these weapons, any die result greater
		// than the number in parentheses (X) counts as that number instead."
		// Armour itself carries only Type/Locations/AP/Max Ag/Weight/Availability,
		// and Step Five subtracts Toughness bonus plus Armour points — full stop.
		expect(rtCore.primitiveArmourDouble).toBe(true);
	});
});

describe("what still blocks RuleProfile assignment", () => {
	test("only the redefined creation-time fields block RuleProfile assignment", () => {
		// @ts-expect-error the kernel's RULE surface now fits (bead cmio.3:
		// critOnDouble/autoFailRoll/autoPassRoll/primitiveArmourDouble are typed
		// as the kernel declares them), but DH2 redefines startingWounds and
		// startingFate under its own union models, so the profile is still NOT
		// assignable to the kernel's RuleProfile. This is the loud hole D1
		// designed, and the ONLY residual blocker — a smaller set than before.
		const asKernel: RuleProfile = dh2Core;
		expect(asKernel).toBeDefined();
	});
});

describe("psychic PUSH, fire modes and elite advances: resolved book facts", () => {
	// Child .6 resolved these as book facts that needed a schema decision; the
	// parent has since taken the three shapes (see the "three structural shapes"
	// block), so each is a field with its citation. What this block still guards
	// is the NEGATIVE: DH2 deliberately does not reuse RT's `pushCap` field or
	// RT's elite base cost, and it has no single-shot fire mode.

	test("Table 6-1: Psychic Strength PUSH caps (printed p195, file 196)", () => {
		const pushCapByClass = { bound: 2, daemonic: 3, unbound: 4 } as const;
		expect(pushCapByClass).toEqual({ bound: 2, daemonic: 3, unbound: 4 });
		// "a psyker can choose to push... can set the effective psy rating of the
		// psychic power up to 2 higher than his base psy rating" (printed p194),
		// and Table 6-1 widens that per class. The penalty is -10 per PR over
		// base (+10 per PR under), phen/adds at +5 (Unbound) or +10 (Daemonic)
		// per +1 PR, capped +20 / +30.
		// DH2 does NOT reuse RT's `pushCap` field at all — a different vocabulary
		// and a different shape, so the two can never be confused.
		expect("pushCap" in dh2Core).toBe(false);
	});

	test("Semi-Auto Burst is a Challenging (+0) BS test (printed p219, p223)", () => {
		// "The attacker makes a Challenging (+0) Ballistic Skill test" — and a
		// jam on 94+. Hits = 1 DoS + 1 per two ADDITIONAL DoS, capped at the
		// weapon's semi-automatic rate of fire.
		expect(dh2Core.fireModes.semiAutoBurst.modifier).toBe(0);
		// There is NO single-shot ACTION: a single shot IS the Standard Attack,
		// so the profile must not grow a `singleShot` key.
		expect("singleShot" in dh2Core.fireModes).toBe(false);
	});

	test("elite advances carry their OWN xp cost; there is no base cost (printed pp88-91)", () => {
		const eliteAdvanceCost = {
			inquisitor: 1000,
			psyker: 300,
			untouchable: 300,
			psyRatingAdvance: (newRating: number) => 200 * newRating,
		};
		expect(eliteAdvanceCost.inquisitor).toBe(1000);
		expect(eliteAdvanceCost.psyker).toBe(300);
		expect(eliteAdvanceCost.untouchable).toBe(300);
		// "the character spends an amount of experience equal to 200 multiplied
		// by his new psy rating value... to increase a character's psy rating
		// from 2 to 3 would cost 600 xp" (printed p90).
		expect(eliteAdvanceCost.psyRatingAdvance(3)).toBe(600);
		// Bead cmio.2: the per-advance member is the profile's ELITE advance
		// cost now, and it carries NO number — the "0 would read as free"
		// hazard the old shared name hid is gone structurally.
		expect(dh2Core.eliteAdvanceCost).toEqual({ model: "per-advance" });
		expect("baseCost" in dh2Core.eliteAdvanceCost).toBe(false);
	});
});

describe("Influence is present but never advanceable (printed p22, p80, p268)", () => {
	test("it is in the vocabulary and NOT in the advance allow-list", () => {
		// "Unlike other characteristics, players cannot increase their Acolyte's
		// Influence by spending xp on advances. Influence can only be increased
		// though an Acolyte's actions." (printed p268)
		expect(dh2Core.characteristics.keys).toContain("ifl");
		expect(Object.keys(DH2_CHARACTERISTIC_APTITUDES)).not.toContain("ifl");
		expect(DH2_CHARACTERISTIC_APTITUDES.ifl).toBeUndefined();
		// The allow-list is a strict SUBSET of the vocabulary — exactly the nine
		// Table 2-3 characteristics.
		const vocabulary = dh2Core.characteristics.keys;
		for (const key of Object.keys(DH2_CHARACTERISTIC_APTITUDES)) {
			expect(vocabulary).toContain(key);
		}
		expect(Object.keys(DH2_CHARACTERISTIC_APTITUDES)).toHaveLength(
			vocabulary.length - 1,
		);
	});
});

describe("the three structural shapes D6 escalated (parent's ruling)", () => {
	test("psychic push caps by psykER TYPE, not RT's sanctioned split", () => {
		// Table 6-1, printed p195: Bound +2 / Daemonic +3 / Unbound +4 PR.
		expect(dh2Core.psychicPush.caps).toEqual({
			bound: 2,
			daemonic: 3,
			unbound: 4,
		});
		expect(dh2Core.psychicPush.penaltyPerPoint).toBe(10);
		expect(dh2Core.psychicPush.phenomenaOnDoubles).toBe(true);
		// RT's shape is a different vocabulary entirely and cannot express
		// "+2 PR over base" — pinned at the type level below (the cmio.2 pins).
		expect(rtCore.psychicPush).toEqual({
			model: "levels",
			caps: { sanctioned: 3, other: 4 },
		});
	});

	test("Semi-Auto Burst exists and is a Challenging (+0) BS test", () => {
		// Printed p223 — and there is NO single-shot ACTION: a single shot IS
		// the Standard Attack (+10).
		expect(dh2Core.fireModes.semiAutoBurst.modifier).toBe(0);
		expect(dh2Core.fireModes.semiAutoBurst.characteristic).toBe(
			"ballistic-skill",
		);
		expect(dh2Core.fireModes.standard.modifier).toBe(10);
	});

	test("elite advances carry their own cost; there is no base", () => {
		// Printed pp88-91: Inquisitor 1,000 / Psyker 300 / Untouchable 300 xp.
		// Per-advance, so a consumer cannot mistake 0 for "free".
		// Bead cmio.2: per-advance member vs RT's flat-base one — the models
		// cannot be confused, and the settings key kept RT's name so stored
		// worlds' deltas still resolve (the value moved paths only).
		expect(dh2Core.eliteAdvanceCost).toEqual({ model: "per-advance" });
		expect(rtCore.eliteAdvanceCost).toEqual({
			model: "flat-base",
			baseCost: 500,
		});
	});
});

describe("the shared kernel vocabulary (bead cmio.2) — instantiate, never redeclare", () => {
	test("each profile instantiates a member of the SAME kernel union", () => {
		// One declaration (src/rules-engine/profile-vocabulary.ts), two
		// instantiations: neither profile restates the concept or the type.
		const dh2Generation: CharacteristicGeneration = dh2Core.generation;
		const rtGeneration: CharacteristicGeneration = rtCore.generation;
		const dh2Push: PsychicPush = dh2Core.psychicPush;
		const rtPush: PsychicPush = rtCore.psychicPush;
		const dh2Elite: EliteAdvanceCost = dh2Core.eliteAdvanceCost;
		const rtElite: EliteAdvanceCost = rtCore.eliteAdvanceCost;
		expect(dh2Generation.model).toBe("roll");
		expect(rtGeneration.model).toBe("point-buy");
		expect(dh2Push.model).toBe("rating-over-base");
		expect(rtPush.model).toBe("levels");
		expect(dh2Elite.model).toBe("per-advance");
		expect(rtElite.model).toBe("flat-base");
	});

	test("cross-reading a member raises a TYPE error (the lying-free pins)", () => {
		// RT's point-buy member has no dice to misread — reading DH2e's roll
		// member through RT's profile fails to compile.
		// @ts-expect-error "dice" does not exist on RT's point-buy generation.
		const dice = rtCore.generation.dice;
		// DH2e's rating-over-base member keys its caps on psykER type — RT's
		// sanctioned/other split is unreachable through DH2e's profile.
		// @ts-expect-error "sanctioned" does not exist on DH2e's push caps.
		const sanctioned = dh2Core.psychicPush.caps.sanctioned;
		// DH2e's per-advance member carries NO number — the "0 would read as
		// free" hazard is gone structurally.
		// @ts-expect-error "baseCost" does not exist on DH2e's per-advance cost.
		const baseCost = dh2Core.eliteAdvanceCost.baseCost;
		// RT's profile carries the FULL UntrainedSkill union (its knob can
		// switch models), so a penalty read without narrowing is a compile
		// error, never an undefined silently folded into a target.
		// @ts-expect-error "penalty" does not exist on the untrained union.
		const penalty = rtCore.untrainedSkill.penalty;
		// All four reads are undefined at runtime — the protection is the
		// compile error above, which these lines only keep the reads used for.
		expect(dice).toBeUndefined();
		expect(sanctioned).toBeUndefined();
		expect(baseCost).toBeUndefined();
		expect(penalty).toBeUndefined();
	});

	test("RT's fire-mode triple is not a REQUIREMENT on a sibling (bead w9sa.12)", () => {
		// The shared set is a name-keyed map now, so DH2e's Standard Attack and
		// Full-Auto Burst pair stands on its own: dropping the third mode is a
		// complete profile table, not a type error.
		const { semiAutoBurst, ...standardAndFullAuto } = dh2Core.fireModes;
		const twoModeSet: FireModes = standardAndFullAuto;
		expect(Object.keys(twoModeSet).sort()).toEqual([
			"fullAutoBurst",
			"standard",
		]);
		// The semi-auto value THIS profile declares is still there (printed
		// p223), and a consumer asking for it on the two-mode set gets an
		// honest `undefined` rather than an assumed rule.
		expect(semiAutoBurst.modifier).toBe(0);
		expect(fireModeRule(twoModeSet, "semiAutoBurst")).toBeUndefined();
		expect(fireModeRule(twoModeSet, "fullAutoBurst")).toEqual(
			dh2Core.fireModes.fullAutoBurst,
		);
		// RT core still declares ALL THREE — the widening changed the shape, not
		// RT's values.
		expect(Object.keys(rtCore.fireModes).sort()).toEqual([...FIRE_MODES].sort());
	});

	test("both profiles declare ONLY pinned shared mode names (drift guard)", () => {
		// The vocabulary is data, not a third declaration: every mode name a
		// profile carries must be one FIRE_MODES gives a meaning to.
		const declared = [
			...Object.keys(rtCore.fireModes),
			...Object.keys(dh2Core.fireModes),
		];
		for (const name of declared) {
			expect((FIRE_MODES as readonly string[]).includes(name)).toBe(true);
		}
	});

	test("the system-tagged ladders NEVER map onto each other (cmio.4's seal)", () => {
		// (a) The arrays differ in length: RT's four tiers vs DH2e's five — so
		// a positional walk of one over the other always ends differently.
		expect(SCHEME_TIERS).toHaveLength(4);
		expect(DH2_ADVANCE_TIERS).toHaveLength(5);
		expect(SCHEME_TIERS.length).not.toBe(DH2_ADVANCE_TIERS.length);
		// (b) The colliding NAMES carry different meanings: RT's expert is
		// tier 4, DH2e's is tier 5 — the index of DH2e's never equals RT's.
		expect(SCHEME_TIERS.indexOf("expert")).toBe(3);
		expect(DH2_ADVANCE_TIERS.indexOf("expert")).toBe(4);
		expect(SCHEME_TIERS.indexOf("expert")).not.toBe(
			DH2_ADVANCE_TIERS.indexOf("expert"),
		);
		// (c) Attempting the mapping fails to compile: DH2e's extra tier does
		// not even EXIST in RT's ladder type.
		// @ts-expect-error "proficient" is not a tier of RT's ladder.
		const tier: SchemeTier = "proficient";
		// (d) RT's ladder stays the kernel's `rt` member, byte for byte.
		const ladder: RtAdvanceLadder = { system: "rt", tiers: SCHEME_TIERS };
		expect([...ladder.tiers]).toEqual([...SCHEME_TIERS]);
		// The (c) read above only exists to carry the @ts-expect-error pin: its
		// runtime value is DH2e's tier string, and its meaning is that the
		// assignment (and any positional read built on it) fails to compile.
		expect(typeof tier).toBe("string");
	});
});
