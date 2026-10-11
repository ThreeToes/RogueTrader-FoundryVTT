/**
 * Dark Heresy 2e's rule-knob registry (epic w9sa, child D3).
 *
 * RT's registry (`./rule-knobs.ts`, `RULE_KNOBS`) is ONE instance of the
 * `RuleKnob` shape; this file is a SECOND one, for the sibling system. The
 * shape, the merge and the validate pair are RT's seam and are used UNCHANGED
 * here — bead w9sa.2 parameterised them precisely so a sibling system brings
 * only its own data. Nothing in this file edits, forks or re-exports RT's
 * knobs: `registerRuleKnobRegistry(DARK_HERESY_RULE_KNOB_REGISTRY)` is how a
 * DH2 world puts these in force (bead w9sa.4), and RT's stay the default until
 * then.
 *
 * CITATION DISCIPLINE
 * -------------------
 * Every entry cites the page its `coreValue` came from, and every `coreValue`
 * is READ from the `dh2Core` field its `path` addresses — never restated, so a
 * changed profile value cannot leave a stale number behind in the registry.
 * Where the book answers "there is no such rule", the value is a verified FALSE
 * (not a default): `test.critOnDouble` and `damage.primitiveArmourDouble` are
 * both proven absent by child D6 of this epic, and the registry carries them so
 * a GM can opt IN deliberately rather than by accident.
 *
 * WHOSE KEY, AND WHY SOME KEYS ARE SHARED WITH RT's
 * -------------------------------------------------
 * `labelKeyFor(key)` derives an i18n key in the FLAT, shared `RULES.` namespace,
 * so a DH2 key collides with RT's whenever the two strings match. Collision is
 * fine where both systems' text stays true — `test.critOnDouble`,
 * `damage.primitiveArmourDouble` and `damage.righteousFury` name the same rule
 * with book-neutral wording, so DH2 reuses RT's keys and translations. It is
 * NOT fine where RT's text asserts RT's own core: RT's
 * `RULES.TEST_AUTO_FAIL_ROLL.HINT` says "The Core Rulebook prints no such band,
 * so core is none; a sibling system (Dark Heresy) sets 96", which is FALSE for
 * DH2e (the book prints 100, and the 96 is DH1's unverified memory — corrected
 * by child D6). A knob whose label contradicts its own core value is a silent
 * wrongness, so those two take DH2's own keys. Editing RT's translation instead
 * is out of scope for this bead, so the stale 96 is reported to the parent.
 *
 * DELIBERATELY ABSENT (pinned absent by the test file)
 * ---------------------------------------------------
 *   - RT's psychic push shape: DH2e keys the cap on the PSYKER TYPE (bound 2 /
 *     daemonic 3 / unbound 4, Table 6-1 printed p195), so `psychic.pushCap.*`
 *     addresses `psychicPush.caps.*` and RT's sanctioned/other keys do not
 *     exist here at all.
 *   - RT's fire-mode BONUSES: DH2e's are SIGNED (Standard +10, Full Auto -10,
 *     printed p226) and live on `fireModes`, so `combat.fireModeBonus.*` is
 *     unknown here — the inverted sign must never be readable through the wrong
 *     field.
 *   - RT's elite-advance BASE cost: DH2e's elite advances each carry their own
 *     Experience Cost (printed pp88-91), which `dh2Core.eliteAdvanceBaseCost`
 *     records as "per-advance". There is no number to tune.
 *   - A single-shot fire mode: DH2e has no such ACTION — a single shot IS the
 *     Standard Attack (printed p223).
 *   - Wounds and fate per home world: the flat 7-9 and the fate threshold are
 *     PER-HOME-WORLD data (printed pp32-43), not a system-wide rule, so a
 *     single knob would have to invent a default. The profile carries none and
 *     the registry registers none.
 */

import {
	hintKeyFor,
	labelKeyFor,
	type RuleKnob,
	type RuleKnobRegistry,
} from "./rule-knobs";
import {
	DH2_ADVANCE_COST_COLUMNS,
	DH2_ADVANCE_TIERS,
	dh2Core,
} from "./system-profile-dark-heresy";

/** Dark Heresy 2e's Foundry system id — its own data, declared once. */
export const DH2_SYSTEM_ID = "dark-heresy-2e";

/**
 * DH2's knobs, grouped by section, in display order.
 *
 * The characteristic-advance COSTS (Table 2-2, printed p80) are appended after
 * the literal entries, one knob per CELL of the matrix. One knob per tier would
 * read better, but a tier's value is an OBJECT (`{two, one, zero}`) and the
 * seam's control vocabulary has no record-of-numbers control ("table" validates
 * hit-location BANDS), so a tier-sized knob would need a new control type in
 * RT's rule-knobs.ts — out of scope for this bead. One knob per cell keeps
 * every printed value tunable with a number control, and a GM tuning a single
 * tier still touches only that tier's three cells: the rest of the matrix stays
 * at core and is never restated. Every cell is pinned by the test file.
 */
const KNOBS: RuleKnob[] = [
	// -- test resolution ----------------------------------------------------
	{
		// VERIFIED ABSENT (printed p22, file 23): the Core Mechanic prints
		// exactly two special cases — 1 auto-succeeds, 100 auto-fails — and
		// says nothing about doubles; a DH2e character's Criticals come from
		// damage exceeding wounds (printed p232). Core FALSE, so the knob
		// exists for a GM who wants RT's rule as a house rule.
		key: "test.critOnDouble",
		path: ["critOnDouble"],
		labelKey: "RULES.TEST_CRIT_ON_DOUBLE",
		hintKey: "RULES.TEST_CRIT_ON_DOUBLE.HINT",
		group: "test",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: dh2Core.critOnDouble,
	},
	{
		// Printed p22: "if the result is 100, then the test automatically
		// fails, even if the target number is greater than 100." The core is a
		// PRINTED value, unlike RT's null, so this knob is not nullable — a GM
		// cannot un-print the band. DH2's own key (see the file header).
		key: "test.automaticFailureRoll",
		path: ["autoFailRoll"],
		labelKey: "RULES.TEST_AUTOMATIC_FAILURE_ROLL",
		hintKey: "RULES.TEST_AUTOMATIC_FAILURE_ROLL.HINT",
		group: "test",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.autoFailRoll,
	},
	{
		// Printed p22: "if the result of the percentile roll is 1, the test
		// automatically succeeds" — a single digit, NOT DH1's remembered 01-05.
		key: "test.automaticSuccessRoll",
		path: ["autoPassRoll"],
		labelKey: "RULES.TEST_AUTOMATIC_SUCCESS_ROLL",
		hintKey: "RULES.TEST_AUTOMATIC_SUCCESS_ROLL.HINT",
		group: "test",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.autoPassRoll,
	},
	// -- damage -------------------------------------------------------------
	{
		// VERIFIED ABSENT (printed p148, p168, p227): Primitive (X) is a WEAPON
		// quality that caps each damage die, and Step Five subtracts the
		// Toughness bonus plus the struck location's Armour points — full stop.
		key: "damage.primitiveArmourDouble",
		path: ["primitiveArmourDouble"],
		labelKey: "RULES.DAMAGE_PRIMITIVE_ARMOUR_DOUBLE",
		hintKey: "RULES.DAMAGE_PRIMITIVE_ARMOUR_DOUBLE.HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: dh2Core.primitiveArmourDouble,
	},
	{
		// Printed p227 — the same kernel trigger model as RT ("damaging-hit"),
		// so RT's key and translation are reused rather than forked.
		key: "damage.righteousFury",
		path: ["righteousFury", "enabled"],
		labelKey: "RULES.DAMAGE_RIGHTEOUS_FURY",
		hintKey: "RULES.DAMAGE_RIGHTEOUS_FURY.HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: dh2Core.righteousFury.enabled,
	},
	{
		// Printed p227: "The attacker can replace the result on a single damage
		// die with the number of degrees of success from his attack roll." RT
		// has no equivalent rule, so this is DH2's own key.
		key: "damage.degreesReplaceOneDie",
		path: ["degreesReplaceOneDamageDie"],
		labelKey: "RULES.DAMAGE_DEGREES_REPLACE_ONE_DIE",
		hintKey: "RULES.DAMAGE_DEGREES_REPLACE_ONE_DIE.HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: dh2Core.degreesReplaceOneDamageDie,
	},
	// -- combat -------------------------------------------------------------
	{
		// Printed p226: "a Standard Attack grants a +10 bonus whether the
		// attack is melee or ranged". DH2's OWN key and field: RT's
		// `fireModeBonus` carries bonuses only, while DH2e signs its fire
		// modes, so the two vocabularies must never meet.
		key: "combat.standardAttackBonus",
		path: ["fireModes", "standard", "modifier"],
		labelKey: "RULES.COMBAT_STANDARD_ATTACK_BONUS",
		hintKey: "RULES.COMBAT_STANDARD_ATTACK_BONUS.HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.fireModes.standard.modifier,
	},
	{
		// Printed p226: "using the Full Auto Burst attack action imposes a -10
		// penalty on the attacker's Ballistic Skill test" — the sign is the
		// whole reason DH2 keeps its own field instead of RT's +20 bonus.
		key: "combat.fullAutoBurstPenalty",
		path: ["fireModes", "fullAutoBurst", "modifier"],
		labelKey: "RULES.COMBAT_FULL_AUTO_BURST_PENALTY",
		hintKey: "RULES.COMBAT_FULL_AUTO_BURST_PENALTY.HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.fireModes.fullAutoBurst.modifier,
	},
	{
		// Printed p223: "The attacker makes a Challenging (+0) Ballistic Skill
		// test", jamming on 94+, one hit per two ADDITIONAL degrees of success
		// up to the semi-automatic rate of fire. There is NO single-shot action
		// to tune — a single shot IS the Standard Attack — so no
		// `combat.singleShot*` key exists (pinned absent by the test).
		key: "combat.semiAutoBurstModifier",
		path: ["fireModes", "semiAutoBurst", "modifier"],
		labelKey: "RULES.COMBAT_SEMI_AUTO_BURST_MODIFIER",
		hintKey: "RULES.COMBAT_SEMI_AUTO_BURST_MODIFIER.HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.fireModes.semiAutoBurst.modifier,
	},
	// -- psychic ------------------------------------------------------------
	{
		// Table 6-1, printed p195: PUSH sets the effective psy rating "up to 2
		// higher than his base psy rating" for a Bound psyker. DH2's own key and
		// field: RT's `pushCap {sanctioned, other}` cannot express "+2 PR over
		// base", and its sanctioned/renegade split is not DH2's
		// bound/unbound/daemonic one.
		key: "psychic.pushCap.bound",
		path: ["psychicPush", "caps", "bound"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_BOUND",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_BOUND.HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.bound,
	},
	{
		// Table 6-1, printed p195: a Daemonic psyker pushes to +3.
		key: "psychic.pushCap.daemonic",
		path: ["psychicPush", "caps", "daemonic"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_DAEMONIC",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_DAEMONIC.HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.daemonic,
	},
	{
		// Table 6-1, printed p195: an Unbound psyker pushes to +4.
		key: "psychic.pushCap.unbound",
		path: ["psychicPush", "caps", "unbound"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_UNBOUND",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_UNBOUND.HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.unbound,
	},
	// -- skills -------------------------------------------------------------
	{
		// Printed p80: the Known rank removes "the -20 penalty for untrained
		// skills". DH2 models a FLAT penalty, not RT's half-characteristic
		// model, so this is DH2's own key (RT's is
		// `skills.untrainedSkill.penalty` under a select-model knob).
		key: "skills.untrainedPenalty",
		path: ["untrainedPenalty"],
		labelKey: "RULES.SKILLS_UNTRAINED_PENALTY",
		hintKey: "RULES.SKILLS_UNTRAINED_PENALTY.HINT",
		group: "skills",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.untrainedPenalty,
	},
	// -- creation -----------------------------------------------------------
	{
		// Printed p31: "the player rolls 2d10, adds the results together, and
		// then adds 20" — the DICE are the first half of that printed rule.
		key: "creation.generationDice",
		path: ["generation", "dice"],
		labelKey: "RULES.CREATION_GENERATION_DICE",
		hintKey: "RULES.CREATION_GENERATION_DICE.HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		// The field is typed as the shared discriminated union so a consumer can
		// read RT's point-buy shape too, so the roll member is narrowed exactly
		// as RT's `untrainedSkill.penalty` knob narrows its own union. DH2e's
		// only model is "roll" (printed p31), so the branch is a formality.
		coreValue:
			dh2Core.generation.model === "roll"
				? dh2Core.generation.dice
				: undefined,
	},
	{
		// Printed p31: the +20 added to each characteristic roll. The home
		// world's own per-roll modifier is NOT here: it is per-home-world data
		// (`generation.modifierPerRoll`, 0 in core), and a knob on it would be
		// a system-wide default the book does not give.
		key: "creation.generationBonus",
		path: ["generation", "bonus"],
		labelKey: "RULES.CREATION_GENERATION_BONUS",
		hintKey: "RULES.CREATION_GENERATION_BONUS.HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue:
			dh2Core.generation.model === "roll"
				? dh2Core.generation.bonus
				: undefined,
	},
	{
		// Printed p78: 1,000 xp to SPEND at character creation, with nothing
		// pre-spent — the inverse of RT's 4,500 already spent.
		key: "creation.xpBudget",
		path: ["creationXp"],
		labelKey: "RULES.CREATION_XP_BUDGET",
		hintKey: "RULES.CREATION_XP_BUDGET.HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: dh2Core.creationXp,
	},
];

// -- advancement: the Table 2-2 cost matrix (printed p80) ------------------
for (const tier of DH2_ADVANCE_TIERS) {
	for (const aptitudes of DH2_ADVANCE_COST_COLUMNS) {
		const key = `advancement.characteristicCost.${tier}.${aptitudes}`;
		KNOBS.push({
			// Table 2-2, printed p80. `coreValue` READS the cell from
			// `dh2Core.characteristicAdvanceCost`, so the printed matrix stays
			// the single source and a profile edit cannot leave a stale number
			// here. Ledger assuming: these are the PRICES of advances, so
			// changing one makes every existing character's spent-xp ledger
			// wrong (RT's own advance knobs carry the same hazard).
			key,
			path: ["characteristicAdvanceCost", tier, aptitudes],
			labelKey: labelKeyFor(key),
			hintKey: hintKeyFor(key),
			group: "advancement",
			control: "number",
			hazard: "ledger-assuming",
			coreValue: dh2Core.characteristicAdvanceCost[tier][aptitudes],
		});
	}
}

/** Every DH2e GM-tunable knob, in display order. */
export const DARK_HERESY_RULE_KNOBS: readonly RuleKnob[] = KNOBS;

/** Dark Heresy 2e's registry: its system id over its own knobs. */
export const DARK_HERESY_RULE_KNOB_REGISTRY: RuleKnobRegistry = {
	systemId: DH2_SYSTEM_ID,
	knobs: DARK_HERESY_RULE_KNOBS,
};
