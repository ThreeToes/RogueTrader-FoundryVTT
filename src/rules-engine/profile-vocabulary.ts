/**
 * The shared system-profile vocabulary (bead cmio.2, per the approved report
 * on cmio.1 — PARENT APPROVAL 2026-10-22).
 *
 * Both FFG 40k profiles (`src/ffg/domain/system-profile.ts` for Rogue Trader
 * and `system-profile-dark-heresy.ts` for Dark Heresy 2e) used to DECLARE the
 * same seven concepts twice, with different shapes and — worse — different
 * MEANINGS under shared names (the same-name-type-mismatch class: RT's
 * `eliteAdvanceBaseCost: 500` against DH2's `eliteAdvanceBaseCost:
 * "per-advance"`). Each concept is now declared ONCE here, as a discriminated
 * union (or, where the two books' shapes agree in kind, a plain struct), and
 * each profile instantiates ITS member. The members are LYING-FREE: a member
 * cannot express a value its system does not have (RT's point-buy member has
 * no dice to misread; DH2's per-advance member has no base cost a consumer
 * could mistake for "free"), and the type-level guard pins live in
 * `system-profile-dark-heresy.test.ts` (the @ts-expect-error trick) so
 * cross-reading a member is a compile error, never a silent wrong answer.
 *
 * WHY THE KERNEL: the architecture boundary test forbids the kernel from
 * importing the domain, while domain imports kernel — a type used by BOTH
 * profiles must therefore live where both can see it. The advancement
 * ladder's tier ARRAYS stay per-system runtime data (RT's `SCHEME_TIERS` in
 * `roguetrader/rules/advancement.ts`, DH2's `DH2_ADVANCE_TIERS` in the domain
 * file); only the SHAPES of those arrays are declared here, tagged with the
 * system they belong to so the two vocabularies can never be read
 * positionally across systems (cmio.4's hazard).
 */

/**
 * How a system generates starting characteristics.
 *
 * Rogue Trader uses a point buy (Core Rulebook p14: base 25, 100 points,
 * cap 20 per characteristic); Dark Heresy 2e rolls **2d10 + 20** per
 * characteristic, modified by the home world (printed p31). The two shapes
 * share no field, so they are discriminated rather than merged into one
 * struct with dead leaves.
 */
export type CharacteristicGeneration =
	| {
			model: "point-buy";
			/** Base characteristic value before allocation (RT Core Rulebook p14). */
			base: number;
			/** Total points the budget grants (RT Core Rulebook p14 "Allocating Points"). */
			budget: number;
			/** Per-characteristic cap (RT Core Rulebook p14). */
			cap: number;
	  }
	| {
			model: "roll";
			/**
			 * How many d10s each characteristic roll uses (DH2e printed p31: 2).
			 *
			 * A NUMBER rather than part of the formula string because the printed
			 * pieces of 2d10+20 are GM-tunable rule data: bead w9sa.3 registers one
			 * knob per piece, and the knob machinery has no string control.
			 */
			dice: number;
			/** Added to the total of each characteristic roll (DH2e printed p31: +20). */
			bonus: number;
			/** The printed notation, DERIVED: `${dice}d10+${bonus}`. */
			formula: string;
			/**
			 * The home world's per-roll modifier. 0 in core: a home world's values
			 * are PER-HOME-WORLD data (DH2e printed pp32-43), not a system-wide
			 * rule, so the core profile carries none — the same reason the flat
			 * wounds value is not a system-wide knob either.
			 */
			modifierPerRoll: number;
	  };

/** Rogue Trader's member of {@link CharacteristicGeneration}. */
export type CharacteristicGenerationPointBuy = Extract<
	CharacteristicGeneration,
	{ model: "point-buy" }
>;

/** Dark Heresy 2e's member of {@link CharacteristicGeneration}. */
export type CharacteristicGenerationRoll = Extract<
	CharacteristicGeneration,
	{ model: "roll" }
>;

/**
 * Creation xp economics.
 *
 * The two books state the SAME rule with OPPOSITE conventions: both grant an
 * xp allocation at creation, of which some amount is already gone before
 * play. Rogue Trader grants 5,000 with 4,500 pre-spent (Core Rulebook p13);
 * Dark Heresy 2e grants 1,000 with nothing pre-spent (printed p78). A
 * two-field struct expresses both — a union would discriminate on a
 * DIFFERENCE OF VALUE, not of kind, which is a lie about the shape.
 *
 * The ledger-seed semantic (bead r8mw): `spentAtCreation` books the
 * spent-xp ledger's baseline on each system — RT's totalSpent is the baseline
 * plus the ledger sum. The ledger-assuming knob hazard transfers to this
 * field unchanged.
 */
export type CreationXpEconomics = {
	/** The book's creation allocation. */
	granted: number;
	/** Already gone before play (the ledger's seed value). */
	spentAtCreation: number;
};

/**
 * The rule for an untrained skill test.
 *
 * RT Core targets HALF the governing Characteristic, round down (Core
 * Rulebook p74 + the Dodge example p244); DH2e applies a flat -20 (printed
 * p80) until the Known rank removes it. `flat-penalty`'s `penalty` is the
 * field DH2e needs, which is why this union is RT's shape promoted to the
 * kernel — DH2e collapses onto it losslessly.
 *
 * `half-characteristic` carries the EFFECTIVE-characteristic fold semantics
 * (bead 3swn, owner ruling 2026-10-08) and `flat-penalty` stays on the raw
 * value with the penalty as a visible funnel row — see
 * `system-profile.ts`'s field docs.
 */
export type UntrainedSkill =
	| { model: "half-characteristic" }
	| { model: "flat-penalty"; penalty: number };

/** Dark Heresy 2e's member of {@link UntrainedSkill}. */
export type UntrainedSkillFlatPenalty = Extract<
	UntrainedSkill,
	{ model: "flat-penalty" }
>;

/**
 * A single fire mode's contribution to the attack test.
 *
 * ONE SIGNED set for both systems: RT's core bonuses (+10 semi-auto burst,
 * +20 full-auto burst, Core Rulebook p237) and DH2e's signed modifiers
 * (Standard Attack +10, Full Auto Burst **-10**, printed p226) are the same
 * KIND of number — the modifier the attack test gains — so sign is per-value
 * data, not a reason to fork the field.
 */
export interface FireModeRule {
	/** Modifier applied to the attack characteristic; negative is a penalty. */
	readonly modifier: number;
	/** Which characteristic the attack test uses. */
	readonly characteristic: "weapon-skill" | "ballistic-skill" | "either";
	/** The book citation, when the system's profile carries one. */
	readonly citation?: string;
}

/**
 * The fire-mode set. DH2e has no single-shot ACTION (a single shot IS the
 * Standard Attack, printed p223), so there is deliberately NO `singleShot`
 * key — RT's Standard Attack is its +0 standard mode, and a system that
 * models single shots differently declares its own field.
 */
export type FireModes = {
	standard: FireModeRule;
	semiAutoBurst: FireModeRule;
	fullAutoBurst: FireModeRule;
};

/**
 * Psychic Strength PUSH.
 *
 * Two genuinely different models that scale DIFFERENT quantities and are NOT
 * convertible — RT pushes LEVELS above PR/2 with a sanctioned/renegade split
 * (Core Rulebook Table 6-1, p157), DH2e sets the effective psy rating up to N
 * above BASE with a per-point penalty and doubles triggering phenomena
 * (printed p195). Forcing either through the other's shape is how an
 * inverted sign becomes a silent rules bug, so the model tag carries the
 * difference and no consumer may compute one system's cap from the other's
 * (pinned by the guard tests in system-profile-dark-heresy.test.ts).
 */
export type PsychicPush =
	| {
			model: "levels";
			caps: { readonly sanctioned: number; readonly other: number };
	  }
	| {
			model: "rating-over-base";
			readonly caps: Readonly<
				Record<"bound" | "daemonic" | "unbound", number>
			>;
			/** Penalty per point the effective psy rating is above the psyker's own. */
			readonly penaltyPerPoint: number;
			/** Doubles on the Focus Power test trigger Phenomena instead. */
			readonly phenomenaOnDoubles: boolean;
			readonly citation: string;
	  };

/** Rogue Trader's member of {@link PsychicPush}. */
export type PsychicPushLevels = Extract<PsychicPush, { model: "levels" }>;

/** Dark Heresy 2e's member of {@link PsychicPush}. */
export type PsychicPushRatingOverBase = Extract<
	PsychicPush,
	{ model: "rating-over-base" }
>;

/**
 * Rogue Trader's advancement ladder member — the four Characteristic
 * Advance Scheme tiers (Core Rulebook p38), consumed POSITIONALLY
 * (`SCHEME_TIERS[purchased]`).
 */
export type RtAdvanceLadder = {
	system: "rt";
	tiers: readonly ["simple", "intermediate", "trained", "expert"];
};

/**
 * Dark Heresy 2e's advancement ladder member — Table 2-2's five progression
 * levels (printed p80), walked positionally by its knob registry.
 */
export type Dh2AdvanceLadder = {
	system: "dh2e";
	tiers: readonly [
		"simple",
		"intermediate",
		"trained",
		"proficient",
		"expert",
	];
};

/**
 * The shared advancement-ladder union.
 *
 * The two ladders share tier NAMES ("simple", "intermediate", "trained",
 * "expert") but NOT positions or meanings — RT's expert is tier 4, DH2e's is
 * tier 5. The system tag seals that: a ladder is only ever read through its
 * OWN system's member, so DH2e's fifth tier can never slip into RT's
 * positional read (where it would come back `undefined` = "no advances
 * available"). The runtime guard that pins the two ARRAYS apart lives in
 * `system-profile-dark-heresy.test.ts`; the arrays themselves stay exported
 * from exactly one place per system.
 */
export type AdvanceLadder = RtAdvanceLadder | Dh2AdvanceLadder;

/**
 * Elite advance cost.
 *
 * Same NAME, incompatible type, was the hazard (cmio.4's #1): RT carried
 * `eliteAdvanceBaseCost: 500` (Core Rulebook p39) while DH2e carried
 * `eliteAdvanceBaseCost: "per-advance"` because each of its elite advances
 * carries its OWN Experience Cost (printed pp88-91). The renamed union — with
 * the model tag carrying what the old shared name hid — closes it
 * structurally: nothing can ever again declare a number and a literal under
 * one name.
 */
export type EliteAdvanceCost =
	| { model: "flat-base"; baseCost: number }
	| { model: "per-advance" };

/** Rogue Trader's member of {@link EliteAdvanceCost}. */
export type EliteAdvanceFlatBase = Extract<EliteAdvanceCost, {
	model: "flat-base";
}>;

/** Dark Heresy 2e's member of {@link EliteAdvanceCost}. */
export type EliteAdvancePerAdvance = Extract<EliteAdvanceCost, {
	model: "per-advance";
}>;

/**
 * Starting wounds.
 *
 * RT multiplies the Toughness Bonus (2xTB) plus a die; DH2e gives a FLAT
 * number per home world plus 1d5 (Feral 9, Highborn 9, Forge 8, Hive 8,
 * Shrine 7, Voidborn 7 — printed pp32-43). RT's own variant is carried here
 * too, so a shared consumer can read either without a cast.
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