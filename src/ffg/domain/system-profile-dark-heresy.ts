/**
 * Dark Heresy 2nd Edition profile — the sibling-system proof of the seam.
 *
 * The rules kernel is system-neutral and `RuleProfile`
 * (`src/rules-engine/profile.ts`) carries every difference between the 40k
 * systems as DATA; `rtCore` is one instance of that type, this file is
 * another. Adding DH2 was always meant to be a profile object, not a code
 * branch — `src/rules-engine/profile.ts:9` says so outright.
 *
 * WHY THIS IS NOT A `SystemProfile`: `SystemProfile`
 * (`src/ffg/domain/system-profile.ts`) is RT's OWN creation/advancement
 * constants, several of which are RT concepts DH2e simply does not have —
 * RT's `fireModeBonus {burst:+10, full:+20}` is a BONUS, while DH2e's Full
 * Auto Burst is a **-10 penalty** and its Standard Attack is the +10. Forcing
 * DH2 through that shape would invite reading an inverted sign through the
 * wrong field, which is precisely the class of silent-rules bug this repo
 * refuses. So DH2 declares its own profile type over the SHARED kernel and
 * keeps the two vocabularies apart.
 *
 * EVERY VALUE BELOW CARRIES ITS PAGE CITATION. The values were extracted from
 * the DH2 Core Rulebook's raw text layer on 2026-10-10 (book key `dh_core` in
 * `src/packs/.extraction-src/books.yaml`; file page N == printed page N-1;
 * per-page files only, never the `full.*` dumps) and the six outstanding rule
 * fields were verified against the book on 2026-10-11 by child D6 of epic w9sa
 * (see its bead notes for the page-level evidence). Where the book settles a
 * rule, the value is written. Where the book models something this profile has
 * no field for (psychic PUSH caps, the Semi-Auto Burst modifier, per-advance
 * elite-advance costs), the field is ABSENT and pinned absent by
 * `system-profile-dark-heresy.test.ts` — a loud hole, never a guess, per the
 * repo's "never guess at book content" rule.
 *
 * The DH2 CONTENT packs (talents, psychic powers, enemies...) belong to epic
 * eg4g, not here.
 */

import type { RuleProfile } from "../../rules-engine/profile";
/**
 * How a system generates starting characteristics.
 *
 * RT uses a point buy (base 25, 100 points, cap 20 per characteristic);
 * DH2e rolls **2d10 + 20** per characteristic, modified by the home world
 * (printed p31). The two shapes share no field, so they are discriminated
 * rather than merged into one struct with dead leaves.
 */
export type CharacteristicGeneration =
	| {
			model: "roll";
			/**
			 * How many d10s each characteristic roll uses (printed p31: 2).
			 *
			 * A NUMBER rather than part of the formula string because the printed
			 * pieces of 2d10+20 are GM-tunable rule data: bead w9sa.3 registers one
			 * knob per piece, and the knob machinery has no string control.
			 */
			dice: number;
			/** Added to the total of each characteristic roll (printed p31: +20). */
			bonus: number;
			/** The printed notation, DERIVED: `${dice}d10+${bonus}`. */
			formula: string;
			/**
			 * The home world's per-roll modifier. 0 in core: a home world's values
			 * are PER-HOME-WORLD data (printed pp32-43), not a system-wide rule, so
			 * the core profile carries none — the same reason the flat wounds value
			 * is not a system-wide knob either.
			 */
			modifierPerRoll: number;
	  }
	| {
			model: "point-buy";
			base: number;
			budget: number;
			cap: number;
	  };

/**
 * Starting wounds.
 *
 * RT multiplies the Toughness Bonus (2xTB) plus a die; DH2e gives a FLAT
 * number per home world plus 1d5 (Feral 9, Highborn 9, Forge 8, Hive 8,
 * Shrine 7, Voidborn 7 — printed pp32-43). RT's own variant is carried here
 * too, so a shared consumer can read either without a cast — this is the
 * field DH2 REDEFINES rather than inherits (see `DarkHeresyProfile`).
 */
export type StartingWounds =
	| {
			model: "toughness-multiplier";
			toughnessMultiplier: number;
			dice: string;
			flat: number;
	  }
	| { model: "flat-plus-dice"; flat: number; dice: string };

/**
 * Starting fate.
 *
 * RT rolls 1d10 against printed bands. DH2e has a **Fate threshold**: a
 * maximum set by the home world, topped up at the start of each session, with
 * a one-off +1 chance on the Emperor's Blessing roll (printed p30 and
 * pp293-294). A threshold is not a roll, so it gets its own model. RT's two
 * models ride along so a shared consumer can read either.
 */
export type StartingFate =
	| { model: "bands" }
	| { model: "table" }
	| { model: "threshold"; emperorBlessing: boolean };

/**
 * A single fire mode's contribution to the attack test.
 *
 * DH2e signs these: a Standard Attack is +10 (melee or ranged) and a Full
 * Auto Burst is -10 to BS (printed p226). RT's field carries bonuses only, so
 * DH2 keeps its own field and never reads RT's.
 */
export interface FireModeRule {
	/** Modifier applied to the attack characteristic; negative is a penalty. */
	readonly modifier: number;
	/** Which characteristic the attack test uses. */
	readonly characteristic: "weapon-skill" | "ballistic-skill" | "either";
	readonly citation: string;
}

/**
 * Psychic Strength PUSH — DH2e's model (Table 6-1, printed p195).
 *
 * Deliberately NOT RT's `pushCap {sanctioned, other}`: DH2e keys the cap on the
 * PSYKER TYPE and expresses it as "effective psy rating up to N higher than
 * base", with a -10 penalty per point pushed. RT's shape cannot express "+2 PR
 * over base", and RT's sanctioned/renegade split is not DH2's
 * bound/unbound/daemonic one, so DH2 keeps its own field.
 */
export interface PsychicPushRule {
	readonly caps: Readonly<Record<"bound" | "daemonic" | "unbound", number>>;
	/** Penalty per point the effective psy rating is above the psyker's own. */
	readonly penaltyPerPoint: number;
	/** Doubles on the Focus Power test trigger Phenomena instead (printed p195). */
	readonly phenomenaOnDoubles: boolean;
	readonly citation: string;
}

/**
 * The DH2 profile: the shared kernel, with the fields DH2 must model
 * differently REDEFINED instead of inherited.
 *
 * `startingWounds` and `startingFate` are omitted because DH2's models (flat
 * 7-9 + 1d5; a threshold rather than a 1d10 roll) are not expressible in RT's
 * shapes, and THOSE two are what keep a `DarkHeresyProfile` from being
 * assignable to the kernel's `RuleProfile` today. The four rule fields below
 * (`critOnDouble`, `autoFailRoll`, `autoPassRoll`, `primitiveArmourDouble`)
 * were unverified holes when this interface was written and were verified
 * against the book by child D6 of epic w9sa (printed p22, p148, p168, p195,
 * p226-227); they now carry the book's answers, including the two the book
 * answers with "no such rule". Each still keeps its `| undefined` union so a
 * consumer that predates the verification cannot silently read a value it does
 * not understand.
 *
 * Omitting also keeps `src/rules-engine/profile.ts` and RT's `rtCore`
 * byte-identical.
 */
export interface DarkHeresyProfile
	extends Omit<
		RuleProfile,
		| "startingWounds"
		| "startingFate"
		| "critOnDouble"
		| "autoFailRoll"
		| "autoPassRoll"
		| "primitiveArmourDouble"
	> {
	id: string;
	/** Ten characteristics, in book order, Influence last (printed pp21-22). */
	characteristics: { keys: readonly string[]; labelPrefix: string };
	generation: CharacteristicGeneration;
	/**
	 * A double on a SUCCESSFUL d100 test is NOT a Critical Hit in DH2e.
	 *
	 * VERIFIED ABSENT (printed p22, file 23): The Core Mechanic lists exactly
	 * three steps and exactly two special cases — a roll of 1 automatically
	 * succeeds and a roll of 100 automatically fails — and nothing about doubles.
	 * Character Criticals in DH2e come from damage exceeding wounds (printed
	 * p232), and the only place doubles appear anywhere in the book is the Focus
	 * Power test, where they trigger Psychic Phenomena (printed p195).
	 */
	critOnDouble: boolean | undefined;
	/**
	 * Rolls AT OR ABOVE this value always fail (printed p22, file 23): "if the
	 * result is 100, then the test automatically fails, even if the target
	 * number is greater than 100." Two 0s read as 100 (printed p22).
	 */
	autoFailRoll: number | null | undefined;
	/**
	 * Rolls AT OR BELOW this value always succeed (printed p22, file 23): "if
	 * the result of the percentile roll is 1, the test automatically succeeds,
	 * even if the target number is less than 1." DH2e's band is a single digit,
	 * NOT DH1's 01-05.
	 */
	autoPassRoll: number | null | undefined;
	/**
	 * No primitive-armour rule exists in DH2e — VERIFIED ABSENT.
	 *
	 * Primitive is a WEAPON quality in DH2e, not an armour rule: Primitive (X)
	 * caps each damage die at X (printed p148, file 149). Armour itself only
	 * carries Type / Locations / AP / Max Ag / Weight / Availability (printed
	 * p168), and Step Five subtracts Toughness bonus plus the Armour points of
	 * the struck location and nothing else (printed p227).
	 */
	primitiveArmourDouble: boolean | undefined;
	/**
	 * The characteristic-advance cost matrix — Table 2-2 (printed p80), carried as
	 * the SAME object as `DH2_CHARACTERISTIC_ADVANCE_COST` below.
	 *
	 * It lives on the PROFILE, not only beside it, because a house rule is merged
	 * onto the profile the rules layer reads: bead w9sa.3 registers one knob per
	 * cell, so a GM retunes a single tier's price without restating the matrix
	 * (and without inventing a whole-table control the knob seam does not have).
	 */
	characteristicAdvanceCost: Dh2AdvanceCostMatrix;
	/**
	 * Experience points available to SPEND at character creation.
	 * DH2e gives 1,000 to spend and pre-spends nothing (printed p78), which is
	 * the opposite of RT's 4,500 already spent.
	 */
	creationXp: number;
	preSpentXp: number;
	startingWounds: StartingWounds;
	startingFate: StartingFate;
	fireModes: {
		standard: FireModeRule;
		fullAutoBurst: FireModeRule;
		// Printed p223: a Challenging (+0) BS test, 94+ jams, one hit per two
		// additional degrees of success, bounded by the semi-automatic rate of
		// fire. There is NO single-shot ACTION: a single shot is the Standard
		// Attack, which is why there is no `singleShot` key here.
		semiAutoBurst: FireModeRule;
	};
	/**
	 * Psychic Strength Push (Table 6-1, printed p195): DH2e caps "effective psy
	 * rating up to N above base" by psykER TYPE — Bound +2, Daemonic +3,
	 * Unbound +4 — with a -10 penalty per point pushed and Phenomena on any
	 * Focus Power roll that is NOT doubles. It is deliberately NOT RT's
	 * `pushCap {sanctioned, other}`: RT's shape cannot express "+2 PR over
	 * base", and RT's sanctioned/renegade split is not DH2's bound/unbound /
	 * daemonic one.
	 */
	psychicPush: PsychicPushRule;
	/**
	 * Elite advances carry their OWN Experience Cost — Inquisitor 1,000, Psyker
	 * 300, Untouchable 300 (printed pp88-91) — so there is no base cost to
	 * model, unlike RT's 500 xp. `per-advance` records that the value lives on
	 * each advance, so a future consumer cannot mistake 0 for "free".
	 */
	eliteAdvanceBaseCost: "per-advance";
	/** The flat penalty for using a skill without the Known rank (printed p80). */
	untrainedPenalty: number;
	/**
	 * A successful attacker may replace the result on ONE damage die with the
	 * attack's degrees of success (printed p227). RT has no equivalent rule.
	 */
	degreesReplaceOneDamageDie: boolean;
}

/**
 * Characteristic advances, printed Table 2-2 (printed p80): five progression
 * levels, each a permanent +5, purchased in order. The cost depends on how
 * many aptitudes the character shares with the advance (Two / One / Zero).
 * The example in the book matches: one aptitude -> Simple 250, then
 * Intermediate 500.
 */
export const DH2_ADVANCE_TIERS = [
	"simple",
	"intermediate",
	"trained",
	"proficient",
	"expert",
] as const;
export type Dh2AdvanceTier = (typeof DH2_ADVANCE_TIERS)[number];

/** Table 2-2's columns, in printed order: aptitudes shared with the advance. */
export type Dh2AdvanceAptitudes = "two" | "one" | "zero";

/** One tier's row of Table 2-2: aptitudes shared -> xp cost. */
export type Dh2AdvanceCost = Readonly<Record<Dh2AdvanceAptitudes, number>>;

/** The whole Table 2-2 matrix: tier -> aptitudes shared -> xp cost. */
export type Dh2AdvanceCostMatrix = Readonly<
	Record<Dh2AdvanceTier, Dh2AdvanceCost>
>;

/** Table 2-2's columns as data, in printed order (the knob registry walks these). */
export const DH2_ADVANCE_COST_COLUMNS: readonly Dh2AdvanceAptitudes[] = [
	"two",
	"one",
	"zero",
] as const;

/** Table 2-2 costs, `tier -> aptitudes shared -> xp`. */
export const DH2_CHARACTERISTIC_ADVANCE_COST: Dh2AdvanceCostMatrix = {
	simple: { two: 100, one: 250, zero: 500 },
	intermediate: { two: 250, one: 500, zero: 750 },
	trained: { two: 500, one: 750, zero: 1000 },
	proficient: { two: 750, one: 1000, zero: 1500 },
	expert: { two: 1250, one: 1500, zero: 2500 },
};

/**
 * Table 2-3 (printed p80): the aptitudes tied to each of the NINE
 * characteristic that can be advanced. Influence is absent on purpose — it
 * "changes only as a character performs actions" (printed p22) and, stated as
 * a rule on printed p268, "players cannot increase their Acolyte's Influence by
 * spending xp on advances".
 *
 * THIS MAP IS THE ADVANCE ALLOW-LIST, not the characteristic vocabulary: the
 * profile carries ten characteristics and this map has nine keys, and that
 * difference is the guard that keeps `ifl` from being priced, purchased or
 * advanced by any code path that iterates it.
 */
export const DH2_CHARACTERISTIC_APTITUDES: Readonly<
	Record<string, readonly [string, string]>
> = {
	ws: ["offence", "offence"],
	bs: ["finesse", "finesse"],
	s: ["offence", "offence"],
	t: ["defence", "defence"],
	ag: ["finesse", "finesse"],
	int: ["knowledge", "knowledge"],
	per: ["fieldcraft", "fieldcraft"],
	wp: ["psyker", "psyker"],
	fel: ["social", "social"],
};

/**
 * The printed pieces of DH2e's characteristic generation (printed p31): "the
 * player rolls 2d10, adds the results together, and then adds 20."
 *
 * Declared once so `dh2Core.generation.formula` is DERIVED from them and the
 * notation can never drift from the numbers a knob tunes.
 */
export const DH2_GENERATION_DICE = 2;
export const DH2_GENERATION_MODIFIER = 20;

/**
 * Dark Heresy 2e core profile.
 *
 * Hit locations and the Righteous Fury trigger are deliberately IDENTICAL to
 * RT's: Table 7-3 (printed p226) is the same band table read on the reversed
 * digits, and the trigger is a natural 10 on any damage die. The shared kernel
 * already expresses both, so DH2 reuses RT's data with its own citation rather
 * than forking it. What DIFFERS is the resolution (DH2 rolls 1d5 on the
 * Critical Effects table for type+location; damage weapons without damage deal
 * exactly 1 unreduced point; Righteous Fury effects do not stack and
 * Deathdealer/True Grit do not modify them) — that lives in the rules layer,
 * not in this profile.
 *
 * NOT MODELLED HERE (verified but structural): the home-world data — each
 * home world's flat wounds (7-9) and fate threshold (printed pp32-43) are
 * PER-HOME-WORLD values, not a system-wide rule, so they live on the home
 * world records rather than on this profile. The three shapes child D6
 * escalated (psychicPush, fireModes.semiAutoBurst and the per-advance
 * eliteAdvanceBaseCost) are fields below; the per-advance elite Experience
 * Costs themselves (Inquisitor 1,000 / Psyker 300 / Untouchable 300 xp,
 * printed pp88-91) stay in the ADVANCE records, as the book prints them.
 */
export const dh2Core: DarkHeresyProfile = {
	id: "dh2-core",
	// The four kernel rule fields, VERIFIED against the book by child D6 of epic
	// w9sa. Two of them are answers of "the book has no such rule", which is a
	// verified value and not a guess:
	//  • critOnDouble FALSE — printed p22 (file 23) gives the Core Mechanic's only
	//    two special cases (1 auto-succeeds, 100 auto-fails) and says nothing about
	//    doubles; character Criticals come from damage exceeding wounds (p232).
	//  • primitiveArmourDouble FALSE — Primitive (X) is a WEAPON quality that caps
	//    each damage die (printed p148), and Step Five subtracts Toughness bonus
	//    plus Armour points, full stop (printed p227).
	critOnDouble: false,
	autoFailRoll: 100,
	autoPassRoll: 1,
	primitiveArmourDouble: false,
	righteousFury: { enabled: true, trigger: "damaging-hit" },
	hitLocations: {
		// Table 7-3: Hit Locations, DH2 Core Rulebook printed p226 — identical
		// bands to RT's Table 9-6, read on the reversed digits of the roll.
		"01-10": "head",
		"11-20": "right-arm",
		"21-30": "left-arm",
		"31-70": "body",
		"71-85": "right-leg",
		"86-00": "left-leg",
	},
	characteristics: {
		keys: ["ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel", "ifl"],
		labelPrefix: "CHARACTERISTIC",
	},
	generation: {
		model: "roll",
		// Printed p31: "the player rolls 2d10, adds the results together, and
		// then adds 20."
		dice: DH2_GENERATION_DICE,
		bonus: DH2_GENERATION_MODIFIER,
		formula: `${DH2_GENERATION_DICE}d10+${DH2_GENERATION_MODIFIER}`,
		modifierPerRoll: 0,
	},
	creationXp: 1000,
	// Printed p78: characters "start with 1,000 experience points to SPEND at
	// character creation" — nothing is already spent, unlike RT's 4,500.
	preSpentXp: 0,
	// Table 2-2 (printed p80): the characteristic-advance cost matrix, as the
	// SAME object the exported constant below carries. On the profile so a house
	// rule can be merged onto the numbers the rules layer reads (bead w9sa.3
	// registers one knob per cell).
	characteristicAdvanceCost: DH2_CHARACTERISTIC_ADVANCE_COST,
	startingWounds: {
		model: "flat-plus-dice",
		// The flat value is the home world's (7-9, printed pp32-43); 1d5 is the
		// constant layer every home world adds.
		flat: 0,
		dice: "1d5",
	},
	startingFate: { model: "threshold", emperorBlessing: true },
	fireModes: {
		standard: {
			// Printed p226: "a Standard Attack grants a +10 bonus whether the
			// attack is melee or ranged".
			modifier: 10,
			characteristic: "either",
			citation: "DH2 Core Rulebook p226",
		},
		fullAutoBurst: {
			// Printed p226: "using the Full Auto Burst attack action imposes a
			// -10 penalty on the attacker's Ballistic Skill test" — inverted
			// from RT's +20 bonus, which is why DH2 keeps its own field.
			modifier: -10,
			characteristic: "ballistic-skill",
			citation: "DH2 Core Rulebook p226",
		},
		semiAutoBurst: {
			// Printed p223: "The attacker makes a Challenging (+0) Ballistic
			// Skill test", jams on 94+.
			modifier: 0,
			characteristic: "ballistic-skill",
			citation: "DH2 Core Rulebook p223",
		},
	},
	psychicPush: {
		// Table 6-1, printed p195: "a psyker can choose to push ... up to 2
		// higher than his base psy rating. Certain types of psykers can increase
		// this amount, as indicated in Table 6-1".
		caps: { bound: 2, daemonic: 3, unbound: 4 },
		// "receives a -10 penalty ... for every point the chosen effective psy
		// rating is above his own psy rating".
		penaltyPerPoint: 10,
		// Doubles on the Focus Power test trigger Phenomena instead — and can do
		// so even when the test FAILS.
		phenomenaOnDoubles: true,
		citation: "DH2 Core Rulebook Table 6-1, p195",
	},
	// Printed pp88-91: each elite advance carries its own Experience Cost
	// (Inquisitor 1,000; Psyker 300; Untouchable 300), so there is no base.
	eliteAdvanceBaseCost: "per-advance",
	// Printed p80: the Known rank removes "the -20 penalty for untrained
	// skills" — DH2e uses a flat penalty, not RT's half characteristic.
	untrainedPenalty: -20,
	// Printed p227: "The attacker can replace the result on a single damage
	// die with the number of degrees of success from his attack roll."
	degreesReplaceOneDamageDie: true,
};
