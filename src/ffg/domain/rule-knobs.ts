/**
 * Rule-knob registry + the pure merge/validate pair (epic wxut, child B1).
 *
 * House rules are DATA (AGENTS.md: "homebrew is a seam, not a fork"), so every
 * GM-tunable value in the rules profile is described by ONE registry entry and
 * stored/merged/validated through this module — never by a hardcoded branch
 * inside a resolver. Pure profile data plus pure functions: no Foundry imports
 * and no dependency on the rules layer (the architecture boundary test only
 * lets domain depend on kernel + domain), so the settings seam, the sheet UI
 * and the resolvers can all import it.
 *
 * WHAT IS A KNOB
 * --------------
 * A knob is a GM-tunable LEAF of the profile. Its `key` is the name the delta
 * (the stored house-rule JSON) uses — the section-qualified path
 * "combat.fireModeBonus.burst" — and its `path` is where that leaf actually
 * lives on the profile object (["fireModes", "semiAutoBurst", "modifier"],
 * since bead cmio.2 moved the value onto the shared FireModes shape while the
 * settings key stayed stable for stored worlds). The two differ
 * because the knob namespace groups the profile's fields into named sections
 * (test/damage/combat/.../tables) for display, while the profile keeps its own
 * documented flat shape. The entry carries `path` so the mapping is explicit
 * data, not a naming convention.
 *
 * WHAT IS NOT A KNOB
 * ------------------
 * Only GM-tunable rules enter the registry. System identity
 * (messageFlagNamespace, rollCardTemplate) and the sibling-system extension
 * points (characteristics, skillCatalogPack, psychic.phenomenaTablePack,
 * criticalTables, advancement.xpModel, startingWounds, startingFate) are
 * excluded: they name WHICH system/content a profile is, not a rule a GM
 * tunes. RULE_KNOBS_EXCLUDED_KEYS pins that list.
 *
 * MERGE SEMANTICS
 * ---------------
 * mergeProfile(core, delta) writes each delta value at the knob's path,
 * shallow-copying every container on the way so `core` is never mutated:
 *   - a knob addressing a SCALAR LEAF (critOnDouble, fireModeBonus.burst,
 *     righteousFury.enabled, untrainedSkill.model) leaves every sibling leaf of
 *     the same container at its core value — {burst: 0} keeps `full` at core;
 *   - a knob addressing a WHOLE CONTAINER (tables.hitLocations) replaces it
 *     wholesale — a band absent from the delta is absent from the merge (the
 *     kernel's locationForHit then falls back to body for it), never silently
 *     merged with the core table.
 * A discriminated union follows the same shape rule: its member knobs rebuild
 * the union object member-wise, so a merge can never yield a union the type
 * does not allow (an orphan penalty, or a model with no penalty stored).
 *
 * I18N, PER SYSTEM (bead w9sa.11)
 * ------------------------------
 * labelKey/hintKey are plain string literals derived from the knob key by
 * labelKeyFor()/hintKeyFor() below. The derivation takes the owning registry's
 * `i18nPrefix` so the labels land in THAT system's namespace:
 *
 *   rogue-trader    ""     -> RULES.COMBAT_FIRE_MODE_BONUS_BURST  (incumbent)
 *   dark-heresy-2e  "dh"   -> RULES.DH.COMBAT_STANDARD_ATTACK_BONUS
 *
 * The prefix namespaces the i18n LABELS, not the knob IDS: an id is the stored
 * delta key and its first segment is its group, so prefixing ids would rename
 * released worlds' deltas and break that invariant. Two systems may therefore
 * still register the same id — but only for the same rule, and a same-rule id
 * may deliberately co-own one book-neutral label. `knobNameConflicts` below is
 * the guard that makes any other overlap (an id with a different meaning, a
 * label outside its owner's prefix, a name shadowing another by dotted prefix)
 * fail loudly; src/ffg/domain/rule-knobs-namespaces.test.ts pins the shipped
 * registries against it.
 *
 * Bare literals cannot trip the i18n parity guard, which only matches
 * localize()/format()/t() call ARGUMENTS; the derived shape still matches that
 * guard's KEY_SHAPE so its calls stay green.
 *
 * WHOSE REGISTRY (bead w9sa.2)
 * ---------------------------
 * `RULE_KNOBS` is Rogue Trader's registry, but NO consumer may import it by
 * name: the registry is per-system DATA (epic w9sa, architecture decision 3),
 * so Dark Heresy 2e must be able to replace RT's everywhere without editing
 * RT's files. Everything therefore resolves the ACTIVE registry through the
 * read below and takes it as a parameter where a pure function needs it:
 *   - `ruleKnobRegistry()` / `ruleKnobs()` — the active system's registry
 *     (RT's, `RT_RULE_KNOB_REGISTRY`, until something registers another);
 *   - `knobByKey(key, registry?)`, `knobsForGroup(group, registry?)`,
 *     `mergeProfile(core, delta, registry?)` — pure, parameterised;
 *   - `registerRuleKnobRegistry(registry)` — the ONE binding a sibling system
 *     swaps at its own boot.
 * `validateProfile` has always taken the registry as its first argument, so
 * the pack parser and the settings seam pass theirs through unchanged.
 */

import { rtCore } from "./system-profile";

/** What a knob value can be at rest. */
export type KnobValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| Readonly<Record<string, string>>;

/** The control the settings UI renders for a knob. */
export type KnobControl = "number" | "boolean" | "select" | "table";

/** The knob section — both the display grouping and the key's first segment. */
export type KnobGroup =
	| "test"
	| "damage"
	| "combat"
	| "psychic"
	| "ammo"
	| "skills"
	| "creation"
	| "advancement"
	| "toxic"
	| "criticals"
	| "battlesuit"
	| "tables";

/**
 * How a knob interacts with the rest of the world (shown as a hint by the
 * settings UI): can it be recomputed for characters that already exist, is it
 * only read while a character is being created, or does it assume the spent-xp
 * ledger was built under the core value?
 */
export type KnobHazard = "auto-recomputed" | "creation-only" | "ledger-assuming";

/** One GM-tunable knob. */
export interface RuleKnob {
	/** Delta/settings key, e.g. "combat.fireModes.semiAutoBurst.modifier". */
	readonly key: string;
	/** Where the knob lives on the profile, e.g.
	 * ["fireModes", "semiAutoBurst", "modifier"] (cmio.2's kernel vocabulary). */
	readonly path: readonly [string, ...string[]];
	readonly labelKey: string;
	readonly hintKey: string;
	readonly group: KnobGroup;
	readonly control: KnobControl;
	/** Allowed values for a `select` control. */
	readonly options?: readonly string[];
	/** How changing it affects existing characters. */
	readonly hazard: KnobHazard;
	/**
	 * `number` controls may carry null ONLY where the core profile is null
	 * (the auto-fail/auto-pass bands); everywhere else a null is an error.
	 */
	readonly nullable?: boolean;
	/** The core value, READ from the profile field the knob claims. */
	readonly coreValue: KnobValue;
}

/**
 * Keys that must NEVER become knobs (bead wxut.1 scope): system identity and
 * the sibling-system extension points. Pinned by rule-knobs.test.ts so a
 * future entry cannot quietly grow one.
 */
export const RULE_KNOBS_EXCLUDED_KEYS: readonly string[] = [
	"messageFlagNamespace",
	"rollCardTemplate",
	"characteristics",
	"skillCatalogPack",
	"psychic.phenomenaTablePack",
	"criticalTables",
	"advancement.xpModel",
	"startingWounds",
	"startingFate",
];

// ---------------------------------------------------------------------------
// i18n key derivation
// ---------------------------------------------------------------------------

/** camelCase humps split so fireModeBonus reads as FIRE_MODE_BONUS. */
const CAMEL_HUMP = /([a-z0-9])([A-Z])/g;

/**
 * Rogue Trader's knob i18n prefix — the EMPTY one, i.e. the un-prefixed flat
 * `RULES.<WORDS>` namespace.
 *
 * RT is the INCUMBENT of that namespace and stays there: its label keys ship in
 * all four language files and its knob ids are the delta keys stored in
 * released worlds, so prefixing RT would rename both (bead w9sa.11). A sibling
 * system declares its OWN prefix instead (Dark Heresy 2e: `"dh"`), and exactly
 * one registry may claim each prefix — `knobNameConflicts` enforces it.
 */
export const RT_KNOB_I18N_PREFIX = "";

/**
 * One UPPER_SNAKE prefix segment plus its dot, or "" — never a dotted prefix:
 * `RULES.DH.X` already gives DH2 a namespace without inventing the bare key
 * `RULES.DH`, which would make every one of its labels a child of that key and
 * trip the expandObject constraint below.
 */
function prefixSegment(i18nPrefix: string): string {
	const trimmed = i18nPrefix.trim();
	if (trimmed === "") return "";
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
		throw new RangeError(
			`i18n prefix "${i18nPrefix}" is not one key segment — letters, digits, "_" or "-", no dots: a dotted prefix would nest every label under an intermediate key, which foundry.utils.expandObject rejects`,
		);
	}
	return `${trimmed.toUpperCase()}.`;
}

/**
 * The label key for a knob of the system whose prefix is `i18nPrefix`:
 *
 *   labelKeyFor("combat.fireModeBonus.burst")          -> RULES.COMBAT_FIRE_MODE_BONUS_BURST
 *   labelKeyFor("combat.standardAttackBonus", "dh")   -> RULES.DH.COMBAT_STANDARD_ATTACK_BONUS
 *
 * The default is RT's incumbent, un-prefixed namespace, so RT's labels are the
 * same strings they always were.
 */
export function labelKeyFor(
	key: string,
	i18nPrefix: string = RT_KNOB_I18N_PREFIX,
): string {
	const words = key
		.replace(CAMEL_HUMP, "$1_$2")
		.replaceAll(".", "_")
		.replaceAll("-", "_");
	return `RULES.${prefixSegment(i18nPrefix)}${words.toUpperCase()}`;
}

/** The sibling hint key: "..._BURST" -> "RULES.COMBAT_FIRE_MODE_BONUS_BURST_HINT". */
export function hintKeyFor(
	key: string,
	i18nPrefix: string = RT_KNOB_I18N_PREFIX,
): string {
	// "_HINT" suffix, not a ".HINT" child: Foundry loads lang files through
	// foundry.utils.expandObject, which throws when a key is a dotted prefix of
	// another (label leaf + "X.HINT" child) and swallows the error — dropping
	// the ENTIRE package dictionary, every sheet rendering raw keys. Keep
	// label + hint separate LEAVES (foundry.utils.Localization#loadTranslationFile).
	return `${labelKeyFor(key, i18nPrefix)}_HINT`;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Every GM-tunable knob, grouped by section, in display order. */
export const RULE_KNOBS: readonly RuleKnob[] = [
	// -- test resolution ----------------------------------------------------
	{
		// Core Rulebook: a double (matching tens and units digits) on a
		// successful test is a Critical Hit.
		key: "test.critOnDouble",
		path: ["critOnDouble"],
		labelKey: "RULES.TEST_CRIT_ON_DOUBLE",
		hintKey: "RULES.TEST_CRIT_ON_DOUBLE_HINT",
		group: "test",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.critOnDouble,
	},
	{
		// Rolls at or above this value always fail. The RT Core Rulebook
		// prints no such band, so core is null; a sibling system (DH1) sets 96.
		key: "test.autoFailRoll",
		path: ["autoFailRoll"],
		labelKey: "RULES.TEST_AUTO_FAIL_ROLL",
		hintKey: "RULES.TEST_AUTO_FAIL_ROLL_HINT",
		group: "test",
		control: "number",
		hazard: "auto-recomputed",
		nullable: true,
		coreValue: rtCore.autoFailRoll,
	},
	{
		// Rolls at or below this value always succeed (DH1: 01-05). Unused in
		// the RT Core Rulebook, so core is null.
		key: "test.autoPassRoll",
		path: ["autoPassRoll"],
		labelKey: "RULES.TEST_AUTO_PASS_ROLL",
		hintKey: "RULES.TEST_AUTO_PASS_ROLL_HINT",
		group: "test",
		control: "number",
		hazard: "auto-recomputed",
		nullable: true,
		coreValue: rtCore.autoPassRoll,
	},
	// -- damage -------------------------------------------------------------
	{
		// Core Rulebook: non-primitive weapons deal double wounds to
		// primitive armour.
		key: "damage.primitiveArmourDouble",
		path: ["primitiveArmourDouble"],
		labelKey: "RULES.DAMAGE_PRIMITIVE_ARMOUR_DOUBLE",
		hintKey: "RULES.DAMAGE_PRIMITIVE_ARMOUR_DOUBLE_HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.primitiveArmourDouble,
	},
	{
		// Righteous Fury: the kernel flags triggering hits; the trigger
		// wording rides along on the same object and is not a separate knob.
		key: "damage.righteousFury",
		path: ["righteousFury", "enabled"],
		labelKey: "RULES.DAMAGE_RIGHTEOUS_FURY",
		hintKey: "RULES.DAMAGE_RIGHTEOUS_FURY_HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.righteousFury.enabled,
	},
	// -- combat -------------------------------------------------------------
	{
		// Core Rulebook p237: Semi-Auto Burst = +10 to BS. The key is RT's
		// historical settings key and STAYS (stored worlds' deltas), while the
		// value lives on the shared signed FireModes shape (bead cmio.2).
		key: "combat.fireModeBonus.burst",
		path: ["fireModes", "semiAutoBurst", "modifier"],
		labelKey: "RULES.COMBAT_FIRE_MODE_BONUS_BURST",
		hintKey: "RULES.COMBAT_FIRE_MODE_BONUS_BURST_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.fireModes.semiAutoBurst.modifier,
	},
	{
		// Core Rulebook p237: Full Auto Burst = +20 to BS. Key stays stable; the
		// path follows the shared FireModes shape (bead cmio.2).
		key: "combat.fireModeBonus.full",
		path: ["fireModes", "fullAutoBurst", "modifier"],
		labelKey: "RULES.COMBAT_FIRE_MODE_BONUS_FULL",
		hintKey: "RULES.COMBAT_FIRE_MODE_BONUS_FULL_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.fireModes.fullAutoBurst.modifier,
	},
	// -- psychic ------------------------------------------------------------
	{
		// Table 6-1, Core Rulebook p157: Push = PR +1..+3 for a sanctioned
		// psyker. Key stays (stored worlds' deltas); the caps live on the
		// kernel's levels-member PsychicPush (bead cmio.2).
		key: "psychic.pushCap.sanctioned",
		path: ["psychicPush", "caps", "sanctioned"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_SANCTIONED",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_SANCTIONED_HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.psychicPush.caps.sanctioned,
	},
	{
		// Table 6-1, Core Rulebook p157: renegades/sorcerors push to +4.
		key: "psychic.pushCap.other",
		path: ["psychicPush", "caps", "other"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_OTHER",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_OTHER_HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.psychicPush.caps.other,
	},
	// -- ammo ---------------------------------------------------------------
	{
		// Epic ui4b: firing a loaded launcher can auto-consume the ordnance.
		// The book-accurate default is FALSE (the manual -1 chip), which is
		// the value rules/homebrew.ts#resolveAmmoAutoConsume falls back to.
		key: "ammo.autoConsume",
		path: ["ammoAutoConsume"],
		labelKey: "RULES.AMMO_AUTO_CONSUME",
		hintKey: "RULES.AMMO_AUTO_CONSUME_HINT",
		group: "ammo",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.ammoAutoConsume,
	},
	// -- skills -------------------------------------------------------------
	{
		// Core Rulebook p74 + Dodge example p244: an untrained Basic Skill
		// Test targets HALF the governing Characteristic, round down.
		key: "skills.untrainedSkill.model",
		path: ["untrainedSkill", "model"],
		labelKey: "RULES.SKILLS_UNTRAINED_SKILL_MODEL",
		hintKey: "RULES.SKILLS_UNTRAINED_SKILL_MODEL_HINT",
		group: "skills",
		control: "select",
		options: ["half-characteristic", "flat-penalty"],
		hazard: "auto-recomputed",
		coreValue: rtCore.untrainedSkill.model,
	},
	{
		// The flat-penalty model's visible funnel modifier. The RT core model
		// halves the characteristic instead, so the core profile carries NO
		// penalty — this knob exists so a flat-penalty system (or a house
		// rule) can set one. An empty field in the UI is correct, not a hole.
		key: "skills.untrainedSkill.penalty",
		path: ["untrainedSkill", "penalty"],
		labelKey: "RULES.SKILLS_UNTRAINED_SKILL_PENALTY",
		hintKey: "RULES.SKILLS_UNTRAINED_SKILL_PENALTY_HINT",
		group: "skills",
		control: "number",
		hazard: "auto-recomputed",
		coreValue:
			rtCore.untrainedSkill.model === "flat-penalty"
				? rtCore.untrainedSkill.penalty
				: undefined,
	},
	// -- creation -----------------------------------------------------------
	{
		// Core Rulebook p14: base characteristic value before allocation. Key
		// stays (stored worlds' deltas); the value lives on the kernel's
		// point-buy generation member (bead cmio.2).
		key: "creation.characteristicBase",
		path: ["generation", "base"],
		labelKey: "RULES.CREATION_CHARACTERISTIC_BASE",
		hintKey: "RULES.CREATION_CHARACTERISTIC_BASE_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.generation.base,
	},
	{
		// Core Rulebook p14 "Allocating Points". Key stays; path follows the
		// shared generation union's point-buy member (bead cmio.2).
		key: "creation.pointBuyBudget",
		path: ["generation", "budget"],
		labelKey: "RULES.CREATION_POINT_BUY_BUDGET",
		hintKey: "RULES.CREATION_POINT_BUY_BUDGET_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.generation.budget,
	},
	{
		// Core Rulebook p14: per-characteristic cap.
		key: "creation.pointBuyMax",
		path: ["generation", "cap"],
		labelKey: "RULES.CREATION_POINT_BUY_MAX",
		hintKey: "RULES.CREATION_POINT_BUY_MAX_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.generation.cap,
	},
	{
		// rules/creation.ts step index — the Starting Kit step is the last.
		key: "creation.creatorLastStep",
		path: ["creatorLastStep"],
		labelKey: "RULES.CREATION_CREATOR_LAST_STEP",
		hintKey: "RULES.CREATION_CREATOR_LAST_STEP_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.creatorLastStep,
	},
	// -- advancement --------------------------------------------------------
	{
		// Core Rulebook p13: characters begin with 4,500 xp already spent. Key
		// stays (stored worlds' deltas); the value lives on the shared creation-
		// xp economics struct (bead cmio.2) and keeps its LEDGER-SEED semantic.
		key: "advancement.preSpentBaseline",
		path: ["creationXpEconomics", "spentAtCreation"],
		labelKey: "RULES.ADVANCEMENT_PRE_SPENT_BASELINE",
		hintKey: "RULES.ADVANCEMENT_PRE_SPENT_BASELINE_HINT",
		group: "advancement",
		control: "number",
		hazard: "ledger-assuming",
		coreValue: rtCore.creationXpEconomics.spentAtCreation,
	},
	{
		// Core Rulebook p39: GM-granted Elite Advance, base 500 xp. Key stays
		// (the settings key survived the shared-name rename — bead cmio.2 moved
		// the VALUE to the kernel's EliteAdvanceCost union's flat-base member);
		// the knob keeps its ledger-assuming hazard class (see rules-app.ts:27).
		key: "advancement.eliteAdvanceBaseCost",
		path: ["eliteAdvanceCost", "baseCost"],
		labelKey: "RULES.ADVANCEMENT_ELITE_ADVANCE_BASE_COST",
		hintKey: "RULES.ADVANCEMENT_ELITE_ADVANCE_BASE_COST_HINT",
		group: "advancement",
		control: "number",
		hazard: "ledger-assuming",
		coreValue: rtCore.eliteAdvanceCost.baseCost,
	},
	// -- toxic --------------------------------------------------------------
	{
		// Core Rulebook p117: -5 Toughness Test penalty per point of Damage
		// taken from a Toxic hit.
		key: "toxic.penaltyPerDamagePoint",
		path: ["penaltyPerDamagePoint"],
		labelKey: "RULES.TOXIC_PENALTY_PER_DAMAGE_POINT",
		hintKey: "RULES.TOXIC_PENALTY_PER_DAMAGE_POINT_HINT",
		group: "toxic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.penaltyPerDamagePoint,
	},
	// -- criticals ----------------------------------------------------------
	{
		// The critical tables print ten results, so Critical Damage caps at
		// ten in one location. Kernel data (rules-engine/criticals.ts), which
		// is why the field lives on RuleProfile, not SystemProfile.
		key: "criticals.maxSeverity",
		path: ["criticals", "maxSeverity"],
		labelKey: "RULES.CRITICALS_MAX_SEVERITY",
		hintKey: "RULES.CRITICALS_MAX_SEVERITY_HINT",
		group: "criticals",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.criticals?.maxSeverity,
	},
	// -- battlesuit ---------------------------------------------------------
	{
		// Tau Character Guide p31: removing a Battlesuit Critical Effect is a
		// Hard (-20) Tech-Use or Trade (Armourer) Test.
		key: "battlesuit.repairTestModifier",
		path: ["repairTestModifier"],
		labelKey: "RULES.BATTLESUIT_REPAIR_TEST_MODIFIER",
		hintKey: "RULES.BATTLESUIT_REPAIR_TEST_MODIFIER_HINT",
		group: "battlesuit",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.repairTestModifier,
	},
	// -- tables -------------------------------------------------------------
	{
		// Core Rulebook Table 9-6: Hit Locations (printed p244). WHOLE
		// replacement: the table is read on the REVERSED digits of the
		// to-hit roll (roll 20 reads as 02), so a partial merge would leave a
		// house rule with bands from two different books.
		key: "tables.hitLocations",
		path: ["hitLocations"],
		labelKey: "RULES.TABLES_HIT_LOCATIONS",
		hintKey: "RULES.TABLES_HIT_LOCATIONS_HINT",
		group: "tables",
		control: "table",
		hazard: "auto-recomputed",
		coreValue: rtCore.hitLocations,
	},
];

/** Every knob key, in registry order. */
export const RULE_KNOB_KEYS: readonly string[] = RULE_KNOBS.map(
	(knob) => knob.key,
);

// ---------------------------------------------------------------------------
// The registry as a PARAMETER (bead w9sa.2)
// ---------------------------------------------------------------------------

/**
 * One system's rule-knob registry: WHOSE knobs these are, and which they are.
 *
 * `RULE_KNOBS` above is Rogue Trader's own registry and stays a plain list so
 * every existing caller keeps compiling; a sibling system (DH2) brings its own
 * list and declares it here. `systemId` is the Foundry system id the registry
 * belongs to ("rogue-trader"), which is also the DATA the rules-pack `kind` is
 * DERIVED from — see `ruleProfilePackKindFor`. Nothing about the app, the
 * merge, the diff or the import/export format names a system: they take the
 * registry as a parameter and default to the ACTIVE one.
 */
export interface RuleKnobRegistry {
	/** The Foundry system id this registry belongs to, e.g. "rogue-trader". */
	readonly systemId: string;
	/**
	 * The prefix that namespaces this system's derived i18n LABELS (bead
	 * w9sa.11): `""` for the incumbent flat `RULES.<WORDS>` namespace (Rogue
	 * Trader), `"dh"` for `RULES.DH.<WORDS>` (Dark Heresy 2e). It is NOT applied
	 * to the knob IDS — those are the stored delta keys, and their first segment
	 * is the knob's group. See `labelKeyFor`, and `knobNameConflicts` for the
	 * guard that keeps two systems from sharing a namespace.
	 */
	readonly i18nPrefix: string;
	/** Every GM-tunable knob, grouped by section, in display order. */
	readonly knobs: readonly RuleKnob[];
}

/**
 * Rogue Trader's system id — declared ONCE, as RT's own data, so the pack
 * `kind` ("rogue-trader.rule-profiles") is DERIVED from it rather than written
 * out a second time as a literal.
 */
export const RT_SYSTEM_ID = "rogue-trader";

/** The rules-pack kind segment every system in this family shares. */
const RULE_PROFILE_PACK_KIND_SUFFIX = "rule-profiles";

/**
 * `<systemId>.rule-profiles` — the rules-pack kind for a system.
 *
 * SYSTEM-DERIVED on purpose: the kind is the cross-system gate (an RT pack into
 * a DH2 world, or the reverse, must be REFUSED, not translated), so it has to
 * change with the system. Deriving it from the system id means there is exactly
 * one literal per system — the system id in that system's own registry — and a
 * new system gets its kind for free.
 */
export function ruleProfilePackKindFor(systemId: string): string {
	return `${systemId}.${RULE_PROFILE_PACK_KIND_SUFFIX}`;
}

/** Rogue Trader's registry: its system id over its own knobs. */
export const RT_RULE_KNOB_REGISTRY: RuleKnobRegistry = {
	systemId: RT_SYSTEM_ID,
	// RT owns the un-prefixed flat namespace: its labels and its stored delta
	// keys predate the per-system scheme and must not be renamed (bead w9sa.11).
	i18nPrefix: RT_KNOB_I18N_PREFIX,
	knobs: RULE_KNOBS,
};

/**
 * The registry the machinery currently runs on. A module-level binding rather
 * than a port: this module is domain-layer PURE (no Foundry imports, enforced
 * by architecture.test.ts), and the consumers that must stay Foundry-free —
 * rules/rule-profile-pack.ts above all — cannot reach a port. A sibling system
 * swaps the ONE binding with `registerRuleKnobRegistry` at its own boot,
 * exactly as `setConfigOverrides` swaps the profile binding; the seam is a READ
 * for every consumer.
 */
let activeRegistry: RuleKnobRegistry = RT_RULE_KNOB_REGISTRY;

/** The ACTIVE system's registry (RT's until something registers another). */
export function ruleKnobRegistry(): RuleKnobRegistry {
	return activeRegistry;
}

/** The ACTIVE system's knobs, in registry order — the common read. */
export function ruleKnobs(): readonly RuleKnob[] {
	return activeRegistry.knobs;
}

/** The ACTIVE system's knob keys, in registry order. */
export function ruleKnobKeys(): readonly string[] {
	return activeRegistry.knobs.map((knob) => knob.key);
}

/**
 * Point the machinery at a sibling system's registry (one binding, one call).
 *
 * LAST WRITE WINS and nothing validates the registry's shape: a registry is a
 * system's own authored data, compiled in beside its profile, not world input.
 * Tests that swap it MUST restore it with `resetRuleKnobRegistryForTests` —
 * bun runs every suite in one process, so a leaked foreign registry would
 * quietly retune the RT suites that run later.
 */
export function registerRuleKnobRegistry(registry: RuleKnobRegistry): void {
	activeRegistry = registry;
}

/** Restore RT's registry (test-only: keeps suites from leaking into others). */
export function resetRuleKnobRegistryForTests(): void {
	activeRegistry = RT_RULE_KNOB_REGISTRY;
}

/**
 * The knob registered under a delta key in THIS registry, or undefined.
 * The default reads the ACTIVE system's registry, so a Foundry-free caller can
 * still name one explicitly (tests, a sibling system's own module).
 */
export function findKnob(
	registry: readonly RuleKnob[],
	key: string,
): RuleKnob | undefined {
	for (const knob of registry) if (knob.key === key) return knob;
	return undefined;
}

/** Every knob in one section of THIS registry, in registry order. */
export function knobsInGroup(
	registry: readonly RuleKnob[],
	group: KnobGroup,
): readonly RuleKnob[] {
	return registry.filter((knob) => knob.group === group);
}

/** The knob registered under a delta key, or undefined. */
export function knobByKey(
	key: string,
	registry: readonly RuleKnob[] = ruleKnobs(),
): RuleKnob | undefined {
	return findKnob(registry, key);
}

/** Every knob in one section, in registry order. */
export function knobsForGroup(
	group: KnobGroup,
	registry: readonly RuleKnob[] = ruleKnobs(),
): readonly RuleKnob[] {
	return knobsInGroup(registry, group);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** A stored house-rule delta: knob key -> value. Absent key = core rule. */
export type ProfileDelta = Readonly<Record<string, unknown>>;

function unknownKeyError(key: string, keys: readonly string[]): RangeError {
	return new RangeError(
		`unknown rule knob "${key}" — rejected, not merged. Known knobs: ${keys.join(", ")}`,
	);
}

function collectWrites(
	registry: readonly RuleKnob[],
	delta: ProfileDelta | null | undefined,
): Array<[RuleKnob, unknown]> {
	const writes: Array<[RuleKnob, unknown]> = [];
	for (const [key, value] of Object.entries(delta ?? {})) {
		if (value === undefined) continue; // absent key = core rule
		const knob = findKnob(registry, key);
		if (!knob) {
			throw unknownKeyError(
				key,
				registry.map((entry) => entry.key),
			);
		}
		writes.push([knob, value]);
	}
	return writes;
}

/**
 * A container seen as a mutable bag. The paths are registry data, so the write
 * is necessarily untyped; the cast is always from `unknown` (or `object`), and
 * every path RULE_KNOBS exposes is pinned against the profile shape by the
 * tests in rule-knobs.test.ts.
 */
function boxOf(value: unknown): Record<string, unknown> {
	return value as Record<string, unknown>;
}

/** Whole-container values are copied so the merge never aliases the delta. */
function copyValue(value: unknown): unknown {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? { ...boxOf(value) }
		: value;
}

/**
 * Layer a house-rule delta over a profile: leaf-merge scalars and object knobs
 * (a {burst: 0} delta leaves `full` at core), whole-replace a knob whose path
 * addresses a container (tables.hitLocations). Returns a new profile; `core` is
 * never mutated and no subtree is shared with the delta. Unknown keys throw a
 * RangeError NAMING the key — a typo is never silently dropped.
 *
 * The defaults read the ACTIVE system's registry, so every existing RT caller
 * keeps working untouched; a sibling system (or a test) may name its own.
 *
 * GENERIC over any profile object, and deliberately NOT constrained to
 * `SystemProfile`: the merge is fully dynamic (paths are registry data and every
 * write goes through `boxOf`), so it does not care what the profile IS — which
 * is what lets a sibling system's profile drive the same merge. The constraint
 * that matters is the opposite one: a `DarkHeresyProfile` is intentionally not
 * assignable to `SystemProfile` — after cmio.2 the member TYPES differ (RT's
 * point-buy generation, levels push, flat-base elite cost vs DH2's roll,
 * rating-over-base, per-advance), not because of unverified holes (bead
 * cmio.3 closed those) — and a narrow signature would either force a second
 * merge path or, worse, paper over that hole.
 *
 * Values are written as given: run validateProfile first when the delta comes
 * from a user-facing surface.
 */
export function mergeProfile<P extends object>(
	core: P,
	delta: ProfileDelta | null | undefined,
	registry: readonly RuleKnob[] = ruleKnobs(),
): P {
	const merged: P = { ...core };
	for (const [knob, value] of collectWrites(registry, delta)) {
		// Shallow-copy every container along the path so the shared profile
		// (and any sibling knob writing into the same container) is untouched.
		let parent: unknown = merged;
		const path = knob.path;
		for (const segment of path.slice(0, -1)) {
			const child = boxOf(parent)[segment];
			const detached =
				child !== null && typeof child === "object"
					? { ...boxOf(child) }
					: {};
			boxOf(parent)[segment] = detached;
			parent = detached;
		}
		// A path of length 1 lands here directly on the profile: that is the
		// whole-replacement case (tables.hitLocations).
		boxOf(parent)[path[path.length - 1]] = copyValue(value);
	}
	return merged;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export interface ProfileValidation {
	/** True when every delta key is a registered knob with a well-typed value. */
	readonly valid: boolean;
	/** One message per problem, each naming the key it rejected. */
	readonly errors: readonly string[];
	/** The accepted subset of the delta — never a silently-dropped key. */
	readonly value: ProfileDelta;
}

function describeValue(raw: unknown): string {
	if (typeof raw === "string") return `the string "${raw}"`;
	if (raw === null) return "null";
	if (Array.isArray(raw)) return "an array";
	if (typeof raw === "object") return "an object";
	return String(raw);
}

function indexBy(registry: readonly RuleKnob[]): Map<string, RuleKnob> {
	return new Map(registry.map((knob) => [knob.key, knob]));
}

/**
 * A table is a record of reversed-roll band -> body location key
 * ("86-00" style, exactly as profile.ts#hitLocations keys them). An EMPTY
 * table is allowed — the kernel falls back to body for any unmatched roll
 * (pinned by kernel.test.ts).
 */
const BAND_KEY = /^\d{2}-\d{2}$/;

function tableProblem(knob: RuleKnob, raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return `"${knob.key}" expects a table object of band -> location, got ${describeValue(raw)}`;
	}
	for (const [band, location] of Object.entries(boxOf(raw))) {
		if (!BAND_KEY.test(band)) {
			return `"${knob.key}" has the malformed band "${band}" — bands are "NN-NN" (e.g. "86-00"), keyed on the REVERSED to-hit roll`;
		}
		if (typeof location !== "string" || location.length === 0) {
			return `"${knob.key}" band "${band}" must name a body location, got ${describeValue(location)}`;
		}
	}
	return null;
}

function valueProblem(knob: RuleKnob, raw: unknown): string | null {
	if (raw === null) {
		return knob.nullable
			? null
			: `"${knob.key}" does not accept null (only the auto-fail/auto-pass bands do)`;
	}
	switch (knob.control) {
		case "number":
			return typeof raw === "number" && Number.isFinite(raw)
				? null
				: `"${knob.key}" expects a finite number, got ${describeValue(raw)}`;
		case "boolean":
			return typeof raw === "boolean"
				? null
				: `"${knob.key}" expects a boolean, got ${describeValue(raw)}`;
		case "select":
			return typeof raw === "string" && (knob.options ?? []).includes(raw)
				? null
				: `"${knob.key}" expects one of ${(knob.options ?? []).join(" | ")}, got ${describeValue(raw)}`;
		case "table":
			return tableProblem(knob, raw);
	}
}

/**
 * Check a house-rule delta against a registry. Every rejected key is REPORTED
 * (unknown knobs AND wrong control types) with the key named, and appears in
 * `errors` — never silently dropped. `value` is the accepted subset, so a
 * caller cannot accidentally merge a key the registry does not describe.
 */
export function validateProfile(
	registry: readonly RuleKnob[],
	candidate: ProfileDelta | null | undefined,
): ProfileValidation {
	const byKey = indexBy(registry);
	const errors: string[] = [];
	const value: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(candidate ?? {})) {
		const knob = byKey.get(key);
		if (!knob) {
			errors.push(
				`unknown rule knob "${key}" — rejected, not dropped: it is not in the registry`,
			);
			continue;
		}
		if (raw === undefined) continue; // absent key = core rule
		const problem = valueProblem(knob, raw);
		if (problem) {
			errors.push(problem);
			continue;
		}
		value[key] = raw;
	}
	return { valid: errors.length === 0, errors, value };
}

// ---------------------------------------------------------------------------
// No sibling names (bead w9sa.11)
// ---------------------------------------------------------------------------

/**
 * The i18n namespace a prefix owns, for messages and guard assertions:
 * `""` -> "RULES." (RT's incumbent flat namespace), `"dh"` -> "RULES.DH.".
 */
export function knobLabelNamespace(i18nPrefix: string): string {
	return `RULES.${prefixSegment(i18nPrefix)}`;
}

/** One way two systems' knob names collide. */
export interface KnobNameConflict {
	/** Which rule the pair broke, so a test can pin the failure BY KIND. */
	readonly kind:
		| "duplicate-system"
		| "duplicate-prefix"
		| "duplicate-knob-id"
		| "duplicate-label"
		| "duplicate-hint"
		| "foreign-label"
		| "shared-knob-differs"
		| "shared-label"
		| "shadowed-name";
	/** The systems involved, in registry order (one for a within-system clash). */
	readonly systems: readonly string[];
	/** The names involved: the knob id and/or the i18n key(s). */
	readonly names: readonly string[];
	/** One English sentence naming both systems and the offending name. */
	readonly message: string;
}

/**
 * The parts of a knob that say WHICH RULE it is. The VALUE may legitimately
 * differ between books (that is why each system's `coreValue` is read from its
 * own profile); the rule a shared id names may not.
 */
function ruleShape(knob: RuleKnob): string {
	return JSON.stringify([
		knob.group,
		knob.control,
		knob.options ?? [],
		knob.nullable ?? false,
		knob.path,
	]);
}

/**
 * The no-sibling-names guard: everything that could make two systems' knob
 * names collide, as English sentences naming both systems and the name.
 *
 * A registry is a system's own authored data, so nothing can throw at import
 * time; the guard is a PURE FUNCTION a test (and a future boot-time check) runs
 * over the shipped registries. `[]` means the systems are cleanly separated:
 *
 *   - one registry per system id, one registry per i18n prefix ("" is RT's);
 *   - no registry repeats its own knob id, label key or hint key;
 *   - every label and hint lives under the OWNING system's prefix, unless the
 *     knob id is in `sharedKnobIds`;
 *   - an i18n key held by two systems must belong to ONE knob id that is in
 *     `sharedKnobIds` — the deliberate, book-neutral co-ownership — so a copy
 *     of another system's label under a new id fails loudly;
 *   - two systems that share an id must be describing the SAME rule (group,
 *     control, options, nullability and profile path agree) — a shared id with
 *     a different meaning fails loudly;
 *   - no name is a dotted prefix of another (foundry.utils.expandObject would
 *     reject the pair and drop the whole dictionary).
 *
 * `sharedKnobIds` is the caller's documented allow-list, so a NEW shared rule
 * is a deliberate edit to the guard's data, never an accident. The shipped
 * list is pinned by src/ffg/domain/rule-knobs-namespaces.test.ts.
 */
export function knobNameConflicts(
	registries: readonly RuleKnobRegistry[],
	sharedKnobIds: readonly string[] = [],
): readonly KnobNameConflict[] {
	const conflicts: KnobNameConflict[] = [];
	const systemOwner = new Map<string, string>();
	const prefixOwner = new Map<string, string>();

	for (const registry of registries) {
		const system = registry.systemId;

		const sameSystem = systemOwner.get(system);
		if (sameSystem !== undefined) {
			conflicts.push({
				kind: "duplicate-system",
				systems: [sameSystem, system],
				names: [system],
				message: `two registries claim the system id "${system}" — one system, one registry`,
			});
		} else {
			systemOwner.set(system, system);
		}

		const prefix = registry.i18nPrefix;
		// Keyed on the NAMESPACE, not the raw string: "dh", "DH" and "dh " all
		// produce RULES.DH.* and must therefore be the same claim.
		const namespace = knobLabelNamespace(prefix);
		const prefixOwnerOf = prefixOwner.get(namespace);
		if (prefixOwnerOf !== undefined) {
			conflicts.push({
				kind: "duplicate-prefix",
				systems: [prefixOwnerOf, system],
				names: [knobLabelNamespace(prefix)],
				message: `"${prefixOwnerOf}" and "${system}" both claim the knob i18n prefix "${prefix}" (${knobLabelNamespace(prefix)}) — one namespace per system, and the empty one is the incumbent's`,
			});
		} else {
			prefixOwner.set(namespace, system);
		}

		// Names repeated INSIDE one registry: ids, labels, hints.
		const pickers = [
			["duplicate-knob-id", "knob id", (knob: RuleKnob) => knob.key],
			["duplicate-label", "label key", (knob: RuleKnob) => knob.labelKey],
			["duplicate-hint", "hint key", (knob: RuleKnob) => knob.hintKey],
		] as const;
		for (const [kind, what, pick] of pickers) {
			const seen = new Map<string, string>();
			for (const knob of registry.knobs) {
				const name = pick(knob);
				const first = seen.get(name);
				if (first === undefined) {
					seen.set(name, knob.key);
					continue;
				}
				conflicts.push({
					kind,
					systems: [system],
					names: [name, first],
					message: `${system} registers the ${what} "${name}" twice ("${first}" and "${knob.key}")`,
				});
			}
		}

		// A label lives under its OWN prefix unless the id is deliberately shared.
		for (const knob of registry.knobs) {
			if (sharedKnobIds.includes(knob.key)) continue;
			const expected = [
				["label", labelKeyFor(knob.key, prefix), knob.labelKey],
				["hint", hintKeyFor(knob.key, prefix), knob.hintKey],
			] as const;
			for (const [what, own, actual] of expected) {
				if (actual === own) continue;
				conflicts.push({
					kind: "foreign-label",
					systems: [system],
					names: [actual, knob.key],
					message: `${system}'s ${what} key for "${knob.key}" is "${actual}", outside its own namespace ("${own}") — labels live under the owning system's prefix`,
				});
			}
		}
	}

	// Every i18n name and who holds it.
	const holders = new Map<string, Array<{ system: string; knob: RuleKnob }>>();
	for (const registry of registries) {
		for (const knob of registry.knobs) {
			for (const name of [knob.labelKey, knob.hintKey]) {
				const list = holders.get(name);
				if (list) list.push({ system: registry.systemId, knob });
				else holders.set(name, [{ system: registry.systemId, knob }]);
			}
		}
	}

	for (const [name, list] of holders) {
		const systems = [...new Set(list.map((holder) => holder.system))];
		// A repeat inside ONE system is the duplicate check's finding above; this
		// one is about two different systems.
		if (systems.length < 2) continue;
		const ids = [...new Set(list.map((holder) => holder.knob.key))];
		if (ids.length === 1 && sharedKnobIds.includes(ids[0])) continue;
		conflicts.push({
			kind: "shared-label",
			systems,
			names: [name, ...ids],
			message: `the i18n key "${name}" is claimed by ${systems.join(" and ")} (${ids.join(", ")}) — a label may be shared only by ONE knob id listed as deliberately shared, and every other label lives under its owner's prefix`,
		});
	}

	// Dotted-prefix shadowing, the expandObject hazard, across every name.
	const names = [...holders.keys()];
	for (const shorter of names) {
		for (const longer of names) {
			if (shorter === longer || !longer.startsWith(`${shorter}.`)) continue;
			const shorterHolders = holders.get(shorter) ?? [];
			const longerHolders = holders.get(longer) ?? [];
			conflicts.push({
				kind: "shadowed-name",
				systems: [
					...new Set(
						[...shorterHolders, ...longerHolders].map(
							(holder) => holder.system,
						),
					),
				],
				names: [shorter, longer],
				message: `"${shorter}" is a dotted prefix of "${longer}" — foundry.utils.expandObject rejects that pair and drops the whole dictionary`,
			});
		}
	}

	// The same id in two systems must be the SAME RULE (values may differ).
	for (let i = 0; i < registries.length; i++) {
		for (let j = i + 1; j < registries.length; j++) {
			const mine = registries[i];
			const theirs = registries[j];
			for (const knob of mine.knobs) {
				if (!sharedKnobIds.includes(knob.key)) continue;
				const other = findKnob(theirs.knobs, knob.key);
				if (!other) continue;
				if (ruleShape(knob) === ruleShape(other)) continue;
				conflicts.push({
					kind: "shared-knob-differs",
					systems: [mine.systemId, theirs.systemId],
					names: [knob.key],
					message: `"${mine.systemId}" and "${theirs.systemId}" both register the knob id "${knob.key}" but for different rules (${ruleShape(knob)} vs ${ruleShape(other)}) — a shared id must name the same rule in both books`,
				});
			}
		}
	}

	return conflicts;
}
