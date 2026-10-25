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
 * WHOSE KEY, AND WHY EACH SYSTEM OWNS ITS i18n NAMESPACE
 * ------------------------------------------------------
 * `labelKeyFor(key)` used to derive one FLAT `RULES.` namespace shared by every
 * system, so a DH2 key collided with RT's whenever the two strings matched —
 * and a collision is only harmless while both books' wording stays true. Bead
 * w9sa.11 gave each registry its own prefix: RT keeps the incumbent un-prefixed
 * namespace (`RULES.…`, its released translations and stored deltas), DH2's
 * labels live under `RULES.DH.…` (`DH2_KNOB_I18N_PREFIX = "dh"`).
 *
 * Every entry below therefore takes its label/hint pair from `labelsFor()`, and
 * a label can no longer land in another system's namespace by accident. The
 * only exception is DELIBERATE, same-rule co-ownership: `test.critOnDouble`,
 * `damage.primitiveArmourDouble` and `damage.righteousFury` name the same rule
 * in both books with book-neutral wording, so they keep RT's label keys (the
 * shared-id allow-list in src/ffg/domain/rule-knobs-namespaces.test.ts pins
 * exactly those three). Everything else — including the two automatic
 * pass/fail bands, whose printed values differ — has DH2's own labels.
 *
 * The stale claim in RT's `RULES.TEST_AUTO_FAIL_ROLL_HINT` ("a sibling system
 * (Dark Heresy) sets 96") is RT's own lang string, out of scope here; DH2 no
 * longer reads it, and it is reported to the parent.
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
 *     Experience Cost (printed pp88-91), which `dh2Core.eliteAdvanceCost`
 *     records as the kernel union's `per-advance` member (bead cmio.2 — the
 *     old shared `eliteAdvanceBaseCost` name is gone). There is no number to
 *     tune.
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
 * DH2's knob i18n prefix (bead w9sa.11): its labels live at `RULES.DH.<WORDS>`,
 * a namespace no sibling system may claim (RT owns the un-prefixed one).
 * Declared here as DH2's own data, exactly like `DH2_SYSTEM_ID`.
 */
export const DH2_KNOB_I18N_PREFIX = "dh";

/**
 * The i18n key pair of one DH2 knob, DERIVED from its key under DH2's prefix —
 * never hand-written, so no entry can drift into another system's namespace.
 * The three deliberately co-owned, book-neutral rules spell RT's key out
 * instead (see the file header and the no-sibling-names guard).
 */
function labelsFor(key: string): Pick<RuleKnob, "labelKey" | "hintKey"> {
	return {
		labelKey: labelKeyFor(key, DH2_KNOB_I18N_PREFIX),
		hintKey: hintKeyFor(key, DH2_KNOB_I18N_PREFIX),
	};
}

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
		// exists for a GM who wants RT's rule as a house rule. SHARED id, and
		// the only kind of label NOT under DH2's prefix: the rule is the same
		// and RT's wording is book-neutral, so the two systems CO-OWN this key
		// (the guard's shared-id allow-list pins exactly three such ids).
		key: "test.critOnDouble",
		path: ["critOnDouble"],
		labelKey: "RULES.TEST_CRIT_ON_DOUBLE",
		hintKey: "RULES.TEST_CRIT_ON_DOUBLE_HINT",
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
		...labelsFor("test.automaticFailureRoll"),
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
		...labelsFor("test.automaticSuccessRoll"),
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
		hintKey: "RULES.DAMAGE_PRIMITIVE_ARMOUR_DOUBLE_HINT",
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
		hintKey: "RULES.DAMAGE_RIGHTEOUS_FURY_HINT",
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
		...labelsFor("damage.degreesReplaceOneDie"),
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
		...labelsFor("combat.standardAttackBonus"),
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
		...labelsFor("combat.fullAutoBurstPenalty"),
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
		...labelsFor("combat.semiAutoBurstModifier"),
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
		...labelsFor("psychic.pushCap.bound"),
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.bound,
	},
	{
		// Table 6-1, printed p195: a Daemonic psyker pushes to +3.
		key: "psychic.pushCap.daemonic",
		path: ["psychicPush", "caps", "daemonic"],
		...labelsFor("psychic.pushCap.daemonic"),
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.daemonic,
	},
	{
		// Table 6-1, printed p195: an Unbound psyker pushes to +4.
		key: "psychic.pushCap.unbound",
		path: ["psychicPush", "caps", "unbound"],
		...labelsFor("psychic.pushCap.unbound"),
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: dh2Core.psychicPush.caps.unbound,
	},
	// -- skills -------------------------------------------------------------
	// DELIBERATELY EMPTY: DH2e's flat untrained penalty is the kernel
	// UntrainedSkill union's flat-penalty MEMBER (bead cmio.2 collapsed
	// `untrainedPenalty` onto `dh2Core.untrainedSkill`), and RT's
	// `skills.untrainedSkill.model`/`.penalty` knobs are unknown here (the old
	// `skills.untrainedPenalty` knob was deleted with the collapse — a stored
	// DH2 delta carrying that key is now refused BY NAME).
	// -- creation ----------------------------------------------------------
	{
		// Printed p31: "the player rolls 2d10, adds the results together, and
		// then adds 20" — the DICE are the first half of that printed rule.
		key: "creation.generationDice",
		path: ["generation", "dice"],
		...labelsFor("creation.generationDice"),
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
		...labelsFor("creation.generationBonus"),
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
		// pre-spent — the inverse of RT's 4,500 already spent. The key stays
		// (stored DH2 deltas); the value lives on the shared creation-xp
		// economics struct (bead cmio.2).
		key: "creation.xpBudget",
		path: ["creationXpEconomics", "granted"],
		...labelsFor("creation.xpBudget"),
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: dh2Core.creationXpEconomics.granted,
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
			...labelsFor(key),
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
	// DH2's labels live under its own namespace (bead w9sa.11), so no DH2 label
	// can collide with RT's flat RULES.* family.
	i18nPrefix: DH2_KNOB_I18N_PREFIX,
	knobs: DARK_HERESY_RULE_KNOBS,
};
