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
 * lives on the profile object (["fireModeBonus", "burst"]). The two differ
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
 * I18N
 * ---
 * labelKey/hintKey are plain string literals in the `RULES.` namespace,
 * derived from the knob key by labelKeyFor()/hintKeyFor() below; the
 * translations themselves are a LATER bead (this one adds nothing to
 * lang/*.json). Bare literals cannot trip the i18n parity guard, which only
 * matches localize()/format()/t() call ARGUMENTS; the derived shape still
 * matches that guard's KEY_SHAPE so the later bead's calls stay green.
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

import { rtCore, type SystemProfile } from "./system-profile";

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
	/** Delta/settings key, e.g. "combat.fireModeBonus.burst". */
	readonly key: string;
	/** Where the knob lives on the profile, e.g. ["fireModeBonus", "burst"]. */
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

/** "combat.fireModeBonus.burst" -> "RULES.COMBAT_FIRE_MODE_BONUS_BURST". */
export function labelKeyFor(key: string): string {
	const words = key
		.replace(CAMEL_HUMP, "$1_$2")
		.replaceAll(".", "_")
		.replaceAll("-", "_");
	return `RULES.${words.toUpperCase()}`;
}

/** The sibling hint key: "..._BURST" -> "RULES.COMBAT_FIRE_MODE_BONUS_BURST_HINT". */
export function hintKeyFor(key: string): string {
	// "_HINT" suffix, not a ".HINT" child: Foundry loads lang files through
	// foundry.utils.expandObject, which throws when a key is a dotted prefix of
	// another (label leaf + "X.HINT" child) and swallows the error — dropping
	// the ENTIRE package dictionary, every sheet rendering raw keys. Keep
	// label + hint separate LEAVES (foundry.utils.Localization#loadTranslationFile).
	return `${labelKeyFor(key)}_HINT`;
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
		// Core Rulebook p237: Semi-Auto Burst = +10 to BS.
		key: "combat.fireModeBonus.burst",
		path: ["fireModeBonus", "burst"],
		labelKey: "RULES.COMBAT_FIRE_MODE_BONUS_BURST",
		hintKey: "RULES.COMBAT_FIRE_MODE_BONUS_BURST_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.fireModeBonus.burst,
	},
	{
		// Core Rulebook p237: Full Auto Burst = +20 to BS.
		key: "combat.fireModeBonus.full",
		path: ["fireModeBonus", "full"],
		labelKey: "RULES.COMBAT_FIRE_MODE_BONUS_FULL",
		hintKey: "RULES.COMBAT_FIRE_MODE_BONUS_FULL_HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.fireModeBonus.full,
	},
	// -- psychic ------------------------------------------------------------
	{
		// Table 6-1, Core Rulebook p157: Push = PR +1..+3 for a sanctioned
		// psyker.
		key: "psychic.pushCap.sanctioned",
		path: ["pushCap", "sanctioned"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_SANCTIONED",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_SANCTIONED_HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.pushCap.sanctioned,
	},
	{
		// Table 6-1, Core Rulebook p157: renegades/sorcerors push to +4.
		key: "psychic.pushCap.other",
		path: ["pushCap", "other"],
		labelKey: "RULES.PSYCHIC_PUSH_CAP_OTHER",
		hintKey: "RULES.PSYCHIC_PUSH_CAP_OTHER_HINT",
		group: "psychic",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: rtCore.pushCap.other,
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
		// Core Rulebook p14: base characteristic value before allocation.
		key: "creation.characteristicBase",
		path: ["characteristicBase"],
		labelKey: "RULES.CREATION_CHARACTERISTIC_BASE",
		hintKey: "RULES.CREATION_CHARACTERISTIC_BASE_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.characteristicBase,
	},
	{
		// Core Rulebook p14 "Allocating Points".
		key: "creation.pointBuyBudget",
		path: ["pointBuyBudget"],
		labelKey: "RULES.CREATION_POINT_BUY_BUDGET",
		hintKey: "RULES.CREATION_POINT_BUY_BUDGET_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.pointBuyBudget,
	},
	{
		// Core Rulebook p14: per-characteristic cap.
		key: "creation.pointBuyMax",
		path: ["pointBuyMax"],
		labelKey: "RULES.CREATION_POINT_BUY_MAX",
		hintKey: "RULES.CREATION_POINT_BUY_MAX_HINT",
		group: "creation",
		control: "number",
		hazard: "creation-only",
		coreValue: rtCore.pointBuyMax,
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
		// Core Rulebook p13: characters begin with 4,500 xp already spent.
		key: "advancement.preSpentBaseline",
		path: ["preSpentBaseline"],
		labelKey: "RULES.ADVANCEMENT_PRE_SPENT_BASELINE",
		hintKey: "RULES.ADVANCEMENT_PRE_SPENT_BASELINE_HINT",
		group: "advancement",
		control: "number",
		hazard: "ledger-assuming",
		coreValue: rtCore.preSpentBaseline,
	},
	{
		// Core Rulebook p39: GM-granted Elite Advance, base 500 xp.
		key: "advancement.eliteAdvanceBaseCost",
		path: ["eliteAdvanceBaseCost"],
		labelKey: "RULES.ADVANCEMENT_ELITE_ADVANCE_BASE_COST",
		hintKey: "RULES.ADVANCEMENT_ELITE_ADVANCE_BASE_COST_HINT",
		group: "advancement",
		control: "number",
		hazard: "ledger-assuming",
		coreValue: rtCore.eliteAdvanceBaseCost,
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
 * assignable to `SystemProfile` (RT's fields are omitted there until the book
 * verifies them), and a narrow signature would either force a second merge
 * path or, worse, paper over that hole.
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
