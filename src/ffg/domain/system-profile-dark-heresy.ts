/**
 * Dark Heresy 2nd Edition profile — the sibling-system proof of the seam.
 *
 * The rules kernel is system-neutral and `RuleProfile`
 * (`src/rules-engine/profile.ts`) carries every difference between the 40k
 * systems as DATA; `rtCore` is one instance of that type, this file is
 * another. Adding DH2 was always meant to be a profile object, not a code
 * branch — `src/rules-engine/profile.ts:9` says so outright.
 *
 * THE SHARED VOCABULARY (bead cmio.2): every concept the two books share is
 * declared ONCE in the kernel's `profile-vocabulary.ts` — characteristic
 * generation, creation xp economics, untrained skill, fire modes, psychic
 * push, the advance ladders, elite advance cost, starting wounds/fate — and
 * this file instantiates DH2e's member of each union rather than redeclaring
 * the concept. The member types are pinned (through `Extract` in the kernel)
 * so a cross-read of another system's member is a compile error, pinned by
 * `system-profile-dark-heresy.test.ts`'s @ts-expect-error tests: RT's
 * point-buy has no `dice` to misread, DH2e's `per-advance` elite cost has no
 * base cost a consumer could mistake for "free", and RT's push-cap split is
 * unreachable through DH2e's profile.
 *
 * EVERY VALUE BELOW CARRIES ITS PAGE CITATION. The values were extracted from
 * the DH2 Core Rulebook's raw text layer on 2026-10-10 (book key `dh_core` in
 * `src/packs/.extraction-src/books.yaml`; file page N == printed page N-1;
 * per-page files only, never the `full.*` dumps) and the six outstanding rule
 * fields were verified against the book on 2026-10-11 by child D6 of epic w9sa
 * (see its bead notes for the page-level evidence). Where the book settles a
 * rule, the value is written. Where the book models something this profile has
 * no field for (some of the shared-vocabulary members before the collapse),
 * the field was ABSENT and pinned absent by `system-profile-dark-heresy.test.ts`
 * — a loud hole, never a guess, per the repo's "never guess at book content" rule.
 *
 * The DH2 CONTENT packs (talents, psychic powers, enemies...) belong to epic
 * eg4g, not here.
 */

import type { RuleProfile } from "../../rules-engine/profile";
import type {
	CharacteristicGenerationRoll,
	CreationXpEconomics,
	Dh2AdvanceLadder,
	EliteAdvancePerAdvance,
	FireModes,
	PsychicPushRatingOverBase,
	StartingFate,
	StartingWounds,
	UntrainedSkillFlatPenalty,
} from "../../rules-engine/profile-vocabulary";

/**
 * The DH2 profile: the shared kernel, with the fields DH2 must model
 * differently REDEFINED instead of inherited.
 *
 * `startingWounds` and `startingFate` use DH2's own union members (flat
 * 7-9 + 1d5; a fate threshold rather than a 1d10 roll), which the kernel's
 * RuleProfile optionals cannot express — those two keep a `DarkHeresyProfile`
 * from being assignable to the kernel's `RuleProfile`. The four rule fields
 * (`critOnDouble`, `autoFailRoll`, `autoPassRoll`, `primitiveArmourDouble`)
 * were unverified holes when this interface was written, were verified against
 * the book by child D6 of epic w9sa (printed p22, p148, p168, p195, p226-227)
 * and are declared at the KERNEL's own types (bead cmio.3) — the book's
 * answers, including the two the book answers with "no such rule", are values
 * of the same shape the kernel resolvers read, so the DH2 profile satisfies
 * the kernel's RULE surface and only the creation-time fields remain
 * redefined.
 */
export interface DarkHeresyProfile
	extends Omit<RuleProfile, "startingWounds" | "startingFate"> {
	id: string;
	/** Ten characteristics, in book order, Influence last (printed pp21-22). */
	characteristics: { keys: readonly string[]; labelPrefix: string };
	/** DH2e's member of the kernel generation union: 2d10+20 (printed p31). */
	generation: CharacteristicGenerationRoll;
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
	critOnDouble: boolean;
	/**
	 * Rolls AT OR ABOVE this value always fail (printed p22, file 23): "if the
	 * result is 100, then the test automatically fails, even if the target
	 * number is greater than 100." Two 0s read as 100 (printed p22).
	 */
	autoFailRoll: number | null;
	/**
	 * Rolls AT OR BELOW this value always succeed (printed p22, file 23): "if
	 * the result of the percentile roll is 1, the test automatically succeeds,
	 * even if the target number is less than 1." DH2e's band is a single digit,
	 * NOT DH1's 01-05.
	 */
	autoPassRoll: number | null;
	/**
	 * No primitive-armour rule exists in DH2e — VERIFIED ABSENT.
	 *
	 * Primitive is a WEAPON quality in DH2e, not an armour rule: Primitive (X)
	 * caps each damage die at X (printed p148, file 149). Armour itself only
	 * carries Type / Locations / AP / Max Ag / Weight / Availability (printed
	 * p168), and Step Five subtracts Toughness bonus plus the Armour points of
	 * the struck location and nothing else (printed p227).
	 */
	primitiveArmourDouble: boolean;
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
	 * Creation xp economics (printed p78): 1,000 granted, NOTHING pre-spent.
	 * The shared two-field struct — the OPPOSITE convention of RT's 5,000
	 * granted / 4,500 pre-spent, whose old pair of fields (`creationXp`,
	 * `preSpentXp`) invited reading one for the other.
	 */
	creationXpEconomics: CreationXpEconomics;
	startingWounds: StartingWounds;
	startingFate: StartingFate;
	/**
	 * The shared fire-mode shape, with DH2e's SIGNED values (printed p223,
	 * p226): Standard Attack +10, Full Auto Burst -10, Semi-Auto Burst +0 —
	 * the sign inversion versus RT's bonuses is per-VALUE data under the
	 * shared shape, not a reason to fork the field.
	 */
	fireModes: FireModes;
	/**
	 * Psychic Strength Push (Table 6-1, printed p195): the kernel union's
	 * `rating-over-base` member — DH2e caps "effective psy rating up to N
	 * above base" by psykER TYPE — Bound +2, Daemonic +3, Unbound +4 — with a
	 * -10 penalty per point pushed and Phenomena on any Focus Power roll that
	 * is NOT doubles. Deliberately NOT convertible with RT's `levels` member
	 * (see the kernel union's doc).
	 */
	psychicPush: PsychicPushRatingOverBase;
	/**
	 * Elite advances carry their OWN Experience Cost — Inquisitor 1,000, Psyker
	 * 300, Untouchable 300 (printed pp88-91) — so there is no base cost to
	 * model, unlike RT's 500 xp. DH2e's member of the kernel's
	 * `EliteAdvanceCost` union: the `per-advance` model carries NO number, so
	 * the "0 would read as free" hazard the old `"per-advance"` literal hid
	 * disappears structurally.
	 */
	eliteAdvanceCost: EliteAdvancePerAdvance;
	/**
	 * The untrained-skill rule as DH2e's member of the kernel's
	 * `UntrainedSkill` union (printed p80): the Known rank removes "the -20
	 * penalty for untrained skills" — a flat penalty, not RT's half
	 * characteristic.
	 */
	untrainedSkill: UntrainedSkillFlatPenalty;
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
 *
 * The array is DH2e's member of the kernel's `AdvanceLadder` union, typed as
 * the `dh2e` member's own tier tuple — RT's ladder is a DIFFERENT
 * vocabulary (four tiers, exported once from
 * `roguetrader/rules/advancement.ts`), and the system tag plus the guard test
 * in `system-profile-dark-heresy.test.ts` pin that the two are never read
 * positionally across systems.
 */
export const DH2_ADVANCE_TIERS: Dh2AdvanceLadder["tiers"] = [
	"simple",
	"intermediate",
	"trained",
	"proficient",
	"expert",
];
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
 * escalated (psychicPush, fireModes.semiAutoBurst and the per-advance elite
 * Experience Costs) are fields below; the per-advance elite Experience Costs
 * themselves (Inquisitor 1,000 / Psyker 300 / Untouchable 300 xp, printed
 * pp88-91) stay in the ADVANCE records, as the book prints them.
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
	// Printed p78: characters "start with 1,000 experience points to SPEND at
	// character creation" — nothing is already spent, unlike RT's 4,500.
	creationXpEconomics: { granted: 1000, spentAtCreation: 0 },
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
			// from RT's +20 bonus, a VALUE difference under the shared shape.
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
		model: "rating-over-base",
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
	eliteAdvanceCost: { model: "per-advance" },
	// Printed p80: the Known rank removes "the -20 penalty for untrained
	// skills" — DH2e's member of the kernel's UntrainedSkill union (the
	// flat-penalty model; RT halves the characteristic).
	untrainedSkill: { model: "flat-penalty", penalty: -20 },
	// Printed p227: "The attacker can replace the result on a single damage
	// die with the number of degrees of success from his attack roll."
	degreesReplaceOneDamageDie: true,
};