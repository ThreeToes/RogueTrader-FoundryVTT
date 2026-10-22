/**
 * The item-taxonomy registry (epic cmio, bead cmio.5 — audit finding A4).
 *
 * The shared effect liveness (`effectsAreLive`, model/effect.ts), the
 * intrinsic-attack gate (`attackProfileOf`, model/attack.ts) and the funnel's
 * breakdown labels (`sourceFor`, effects/specs.ts) used to hard-code Rogue
 * Trader's item types as inline constants. A sibling system's item types
 * would have been silently DEAD — effects ignored, attacks refused — rather
 * than wrong, which is the worst failure mode an audit can find (invisible).
 *
 * WHAT IS REGISTRY DATA
 * ---------------------
 * One system's item taxonomy is ONE object, and every set on it is THAT
 * SYSTEM'S data, not the kernel's:
 *   - `declaredItemTypes` — the system's full item vocabulary. RT's list is
 *     exactly the keys of `DataModelConfig.Item` in
 *     `src/roguetrader/foundry.d.ts` (the type-level declaration of the same
 *     vocabulary); the two MUST move together, and a type added to the
 *     DataModelConfig without a matching entry here LOUDLY refuses at runtime
 *     (this throw is the pinned notice, not silent drift).
 *   - `innateEffectTypes` — the types whose effects are always live (known or
 *     innate, not carried). Formerly `INNATE_EFFECT_TYPES` in model/effect.ts.
 *   - `equipStatesForEffects` — physical types -> the equip state that makes
 *     their effects live. Formerly `EQUIP_STATES_FOR_EFFECTS` there too.
 *   - `intrinsicAttackTypes` — the types that carry an attack of their own:
 *     weapons from their own system data (the kernel `isWeaponType` gate
 *     covers those), mutations (and any non-weapon member) from an authored
 *     `attack` block. Formerly the `type !== "mutation"` literal, attack.ts.
 *   - `sourceLabels` — item type -> the funnel breakdown's source label key.
 *     Formerly `SOURCE_LABELS` in effects/specs.ts. A declared type WITHOUT a
 *     label falls back to the gear label (RT ships one: a psychic power's
 *     contributions have always rendered under the gear label); an UNDECLARED
 *     type never reaches the label lookup, because every consumer gates on
 *     `effectsAreLive` (or refuses below) first.
 *
 * WHAT IS NOT REGISTRY DATA
 * -------------------------
 * `WEAPON_ITEM_TYPES` / `isWeaponType` (model/taxonomy.ts) stay kernel: the
 * melee/ranged weapon vocabulary is also consumed by the data schema
 * factories and the equip model, and both 40k systems name their weapons the
 * same. The audit's three sites are the sets above.
 *
 * WHOSE REGISTRY (the w9sa.2 seam shape)
 * -------------------------------------
 * Exactly the rule-knob-registry pattern: `RT_ITEM_TAXONOMY_REGISTRY` is
 * Rogue Trader's own data and the DEFAULT binding, so every existing RT
 * caller keeps behaving byte-identically and RT needs no boot-time call.
 * Everything resolves the ACTIVE registry through the read below:
 *   - `itemTaxonomyRegistry()` — the active system's registry;
 *   - `registerItemTaxonomyRegistry(registry)` — the ONE binding a sibling
 *     system swaps at its own boot (DH2's composition root will call it next
 *     to its `registerRuleKnobRegistry` once DH2 authors item types; it has
 *     none today, so supplying RT's sets under DH2's name would be fabricated
 *     taxonomy and is deliberately NOT done);
 *   - `resetItemTaxonomyRegistryForTests()` — test-only restore.
 * `requireDeclaredItemType` is the LOUD half: a foreign (undeclared) item
 * type is refused BY NAME with a RangeError, everywhere, instead of quietly
 * contributing nothing.
 */

import { RT_SYSTEM_ID } from "../rule-knobs";

/** One system's item taxonomy: what its items are and what they do. */
export interface ItemTaxonomyRegistry {
	/** The Foundry system id this registry belongs to, e.g. "rogue-trader". */
	readonly systemId: string;
	/** Every item type the system declares, as a flat vocabulary. */
	readonly declaredItemTypes: readonly string[];
	/** Item types whose effects are always live (known, not carried). */
	readonly innateEffectTypes: readonly string[];
	/** Physical item types -> the equip state that makes their effects live. */
	readonly equipStatesForEffects: Readonly<
		Record<string, readonly string[]>
	>;
	/** Item types that carry an attack of their own (weapon fields/attack block). */
	readonly intrinsicAttackTypes: readonly string[];
	/** Item type -> the breakdown source label key. */
	readonly sourceLabels: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Rogue Trader's registry (the default binding)
// ---------------------------------------------------------------------------

/**
 * Rogue Trader's item vocabulary: the keys of `DataModelConfig.Item` in
 * `src/roguetrader/foundry.d.ts`, as runtime data. The plain-Gear subtypes
 * (aptitude/tool/drug/special-ability, bead 5p8) are their own TYPE keys even
 * though they reuse Gear's schema — declared, so their items resolve normally.
 */
const RT_DECLARED_ITEM_TYPES: readonly string[] = [
	"action",
	"gear",
	"ranged-weapon",
	"melee-weapon",
	"armour",
	"battlesuit",
	"battlesuit-system",
	"skill",
	"talent",
	"career",
	"ship",
	"ship-complication",
	"ship-component",
	"ship-weapon-component",
	"ship-action",
	"ship-ordnance",
	"game-table",
	"gearset",
	"psychicpower",
	"navigatorpower",
	"origintrait",
	"origin",
	"warrant-option",
	"heirloom",
	"mutation",
	"madnessentry",
	"trait",
	"aptitude",
	"ammunition",
	"force-field",
	"weapon-modification",
	"armour-modification",
	"tool",
	"drug",
	"special-ability",
];

/** Item types whose effects are always live (known, not carried): talents and
 * psychic powers are "known"; rulebook traits, mutations and madness entries
 * are innate conditions the actor always has. Moved verbatim from
 * model/effect.ts (formerly `INNATE_EFFECT_TYPES`). */
const RT_INNATE_EFFECT_TYPES: readonly string[] = [
	"talent",
	"psychicpower",
	"trait",
	"mutation",
	"madnessentry",
];

/** Physical item types -> the equip state that makes their effects live.
 * Moved verbatim from model/effect.ts (formerly `EQUIP_STATES_FOR_EFFECTS`). */
const RT_EQUIP_STATES_FOR_EFFECTS: Readonly<Record<string, readonly string[]>> =
	{
		armour: ["worn"],
		gear: ["carried"],
		"melee-weapon": ["carried"],
		"ranged-weapon": ["carried"],
	};

/** The types that carry an attack of their own. Weapons resolve from their
 * own system data (the kernel `isWeaponType` gate covers exactly these two);
 * a mutation resolves from its authored `attack` block (Corrosive Bile, Core
 * Rulebook p369). Moved from the `type !== "mutation"` literal in attack.ts. */
const RT_INTRINSIC_ATTACK_TYPES: readonly string[] = [
	"melee-weapon",
	"ranged-weapon",
	"mutation",
];

/** Item type -> the breakdown source label. Moved verbatim from
 * effects/specs.ts (formerly `SOURCE_LABELS`). Exported so tests can pin the
 * registry's shape against the moved constant. */
export const RT_SOURCE_LABELS: Readonly<Record<string, string>> = {
	talent: "SOURCE.FROM_TALENTS",
	trait: "SOURCE.FROM_TRAITS",
	mutation: "SOURCE.FROM_MUTATIONS",
	madnessentry: "SOURCE.FROM_AFFLICTIONS",
	armour: "SOURCE.FROM_ARMOUR",
	gear: "SOURCE.FROM_GEAR",
	"melee-weapon": "SOURCE.FROM_WEAPONS",
	"ranged-weapon": "SOURCE.FROM_WEAPONS",
};

/** Rogue Trader's registry: its system id over its own taxonomy. */
export const RT_ITEM_TAXONOMY_REGISTRY: ItemTaxonomyRegistry = {
	systemId: RT_SYSTEM_ID,
	declaredItemTypes: RT_DECLARED_ITEM_TYPES,
	innateEffectTypes: RT_INNATE_EFFECT_TYPES,
	equipStatesForEffects: RT_EQUIP_STATES_FOR_EFFECTS,
	intrinsicAttackTypes: RT_INTRINSIC_ATTACK_TYPES,
	sourceLabels: RT_SOURCE_LABELS,
};

// ---------------------------------------------------------------------------
// The registry as a PARAMETER (the w9sa.2 seam)
// ---------------------------------------------------------------------------

/**
 * The registry the machinery currently runs on. A module-level binding rather
 * than a port: model/effect.ts, attack.ts and effects/specs.ts are pure
 * domain, so their consumers — headless rules code above all — cannot reach a
 * port, and the knob registry made the same call (rule-knobs.ts, bead w9sa.2).
 * A sibling system swaps the ONE binding with `registerItemTaxonomyRegistry`
 * at its own boot; the seam is a READ for every consumer.
 */
let activeRegistry: ItemTaxonomyRegistry = RT_ITEM_TAXONOMY_REGISTRY;

/** The ACTIVE system's item taxonomy (RT's until something registers another). */
export function itemTaxonomyRegistry(): ItemTaxonomyRegistry {
	return activeRegistry;
}

/**
 * Point the machinery at a sibling system's registry (one binding, one call).
 *
 * LAST WRITE WINS and nothing validates the registry's shape: a registry is a
 * system's own authored data, compiled in beside its profile, not world input.
 * Tests that swap it MUST restore it with `resetItemTaxonomyRegistryForTests`
 * — bun runs every suite in one process, so a leaked foreign registry would
 * break the RT suites that run later.
 */
export function registerItemTaxonomyRegistry(
	registry: ItemTaxonomyRegistry,
): void {
	activeRegistry = registry;
}

/** Restore RT's registry (test-only: keeps suites from leaking into others). */
export function resetItemTaxonomyRegistryForTests(): void {
	activeRegistry = RT_ITEM_TAXONOMY_REGISTRY;
}

// ---------------------------------------------------------------------------
// The loud half: undeclared types are refused BY NAME
// ---------------------------------------------------------------------------

/** The error an undeclared item type raises, naming the type and the system. */
function undeclaredItemTypeError(
	type: string,
	registry: ItemTaxonomyRegistry,
): RangeError {
	return new RangeError(
		`item type "${type}" is not declared by the active system ("${registry.systemId}") — refused rather than silently ignored. Declared item types: ${registry.declaredItemTypes.join(", ")}`,
	);
}

/**
 * Refuse an item type the active system has not declared, BY NAME.
 *
 * Callers use this where a foreign type would otherwise be silently dead
 * (effects ignored, attack refused): model/effect.ts#effectsAreLive and
 * model/attack.ts#attackProfileOf. A DECLARED type that carries no live
 * effects and no attack (a skill, a navigator power) stays a quiet `false` /
 * `null` — the system author decided that — and only the truly undeclared
 * throw. Blank types stay tolerated: an item without a type has neither
 * effects nor attack, exactly as before.
 */
export function requireDeclaredItemType(
	type: string,
	registry: ItemTaxonomyRegistry = itemTaxonomyRegistry(),
): void {
	if (!registry.declaredItemTypes.includes(type)) {
		throw undeclaredItemTypeError(type, registry);
	}
}