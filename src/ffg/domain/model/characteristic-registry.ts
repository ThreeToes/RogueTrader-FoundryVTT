/**
 * The characteristic-vocabulary registry (epic w9sa, bead w9sa.10).
 *
 * Rogue Trader's nine characteristic keys were hand-listed in more than one
 * place: the `CHARACTERISTIC_LABELS` seed in `src/roguetrader/registry.ts`, the
 * `characteristics` SchemaField literal in
 * `src/roguetrader/data/actor/character.ts` (and every picker that read the
 * seed). Dark Heresy 2nd Edition adds a TENTH characteristic — Influence
 * (`ifl`, printed pp21-22; it changes dynamically and is not advanceable) —
 * which Rogue Trader's book does not have, so "the characteristics" is
 * per-system DATA and those hand-lists would have drifted the first time a
 * sibling system landed.
 *
 * THE PROFILE IS THE VOCABULARY. `RuleProfile.characteristics` already declares
 * `{ keys, labelPrefix }` per system (`rtCore`'s nine, `dh2Core`'s ten), so this
 * module RESTATES NOTHING: a registry is a typed view over that declaration,
 * bound to a system id, and the SHORT label map is COMPOSED from the prefix and
 * the keys (`"ws"` -> `"CHARACTERISTIC.WS"`). Rogue Trader's keys and labels are
 * therefore byte-identical to the tables this replaced, and a sibling system's
 * added characteristic reaches its schema and pickers by DECLARING it in its own
 * profile — no fork, no RT field forced on a sibling (epic architecture
 * decision 1).
 *
 * WHOSE REGISTRY (the w9sa.2 seam shape)
 * -------------------------------------
 * Exactly the item-taxonomy (`model/taxonomy-registry.ts`) and rule-knob
 * patterns: `RT_CHARACTERISTIC_REGISTRY` is Rogue Trader's own data and the
 * DEFAULT binding, so every existing RT caller keeps behaving byte-identically
 * and RT needs no boot-time call. A sibling system swaps the ONE binding at its
 * own boot:
 *   - `characteristicRegistry()` — the active system's registry;
 *   - `registerCharacteristicRegistry(registry)` — the swap (DH2's composition
 *     root calls it beside its `registerRuleKnobRegistry`);
 *   - `resetCharacteristicRegistryForTests()` — test-only restore.
 * It is a module-level binding rather than a port because the consumers are pure
 * domain/data code (the Character DataModel composes its schema from it) that
 * cannot reach a port — the same call taxonomy-registry.ts and rule-knobs.ts
 * made.
 *
 * THE LONG FORM IS NOT HERE. The DESCRIPTIVE labels
 * ("CHARACTERISTIC.WEAPON_SKILL", the item effect editor's test-key dropdown)
 * are a different translation in es/fr/pl and stay Rogue Trader's separate
 * registry (`registry.ts#characteristicLongLabels`). This module generates the
 * SHORT form only — the derived vocabulary every schema, sheet and picker
 * renders.
 *
 * NOTHING IS FABRICATED. A profile that declares no characteristic vocabulary
 * raises, naming the system, rather than silently falling back to RT's nine: a
 * DH2 sheet showing Weapon Skill and no Influence is a WRONG sheet, not a
 * missing one.
 */

import { RT_SYSTEM_ID } from "../rule-knobs";
import { rtCore } from "../system-profile";

/** One system's characteristic vocabulary: keys in book order + label prefix. */
export interface CharacteristicVocabulary {
	/** The characteristic keys the system declares, in the book's order. */
	readonly keys: readonly string[];
	/** The i18n namespace short labels compose under ("CHARACTERISTIC"). */
	readonly labelPrefix: string;
}

/** Anything carrying a profile's `characteristics` declaration. */
export interface CharacteristicVocabularySource {
	readonly characteristics?: CharacteristicVocabulary;
}

/** One system's characteristic vocabulary, bound to its system id. */
export interface CharacteristicRegistry extends CharacteristicVocabulary {
	/** The Foundry system id this registry belongs to, e.g. "rogue-trader". */
	readonly systemId: string;
}

/**
 * A profile's declared vocabulary as a registry, or a loud refusal.
 *
 * The keys are copied so a caller cannot mutate the profile's declaration
 * through a registry. Absent, empty and duplicate vocabularies are refused BY
 * NAME: each would build a schema that is silently wrong (no characteristics, no
 * fields, fields overwriting each other) instead of failing loudly.
 */
export function characteristicRegistryFor(
	systemId: string,
	profile: CharacteristicVocabularySource,
): CharacteristicRegistry {
	const vocabulary = profile.characteristics;
	if (!vocabulary) {
		throw new RangeError(
			`system "${systemId}" declares no characteristic vocabulary — its profile must carry characteristics.keys; refused rather than falling back to Rogue Trader's nine`,
		);
	}
	const keys = [...vocabulary.keys];
	if (keys.length === 0) {
		throw new RangeError(
			`system "${systemId}" declares an empty characteristic vocabulary — a profile needs at least one key`,
		);
	}
	const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
	if (duplicates.length > 0) {
		throw new RangeError(
			`system "${systemId}" declares the characteristic key "${duplicates[0]}" twice — every key must be unique`,
		);
	}
	return { systemId, keys, labelPrefix: vocabulary.labelPrefix };
}

// ---------------------------------------------------------------------------
// Rogue Trader's registry (the default binding)
// ---------------------------------------------------------------------------

/**
 * Rogue Trader's registry: the nine characteristics `rtCore` declares, in book
 * order, with the `CHARACTERISTIC` label prefix. Nothing restated — the profile
 * is the one source, which is what keeps the schema, the label map and the
 * pickers from drifting apart.
 */
export const RT_CHARACTERISTIC_REGISTRY: CharacteristicRegistry =
	characteristicRegistryFor(RT_SYSTEM_ID, rtCore);

// ---------------------------------------------------------------------------
// The registry as a PARAMETER (the w9sa.2 seam)
// ---------------------------------------------------------------------------

/** The registry the machinery currently runs on. */
let activeRegistry: CharacteristicRegistry = RT_CHARACTERISTIC_REGISTRY;

/** The ACTIVE system's characteristic registry (RT's until a sibling registers). */
export function characteristicRegistry(): CharacteristicRegistry {
	return activeRegistry;
}

/**
 * Point the machinery at a sibling system's registry (one binding, one call).
 *
 * LAST WRITE WINS and nothing validates the registry's shape: a registry is a
 * system's own authored data, compiled in beside its profile, not world input.
 * Tests that swap it MUST restore it with `resetCharacteristicRegistryForTests`
 * — bun runs every suite in one process, so a leaked sibling registry would
 * build RT's suites against the wrong schema.
 */
export function registerCharacteristicRegistry(
	registry: CharacteristicRegistry,
): void {
	activeRegistry = registry;
}

/** Restore RT's registry (test-only: keeps suites from leaking into others). */
export function resetCharacteristicRegistryForTests(): void {
	activeRegistry = RT_CHARACTERISTIC_REGISTRY;
}

// ---------------------------------------------------------------------------
// What is generated from a registry
// ---------------------------------------------------------------------------

/**
 * The registry's characteristic keys, in book order.
 *
 * This is the ONE source the Character DataModel's characteristic schema is built
 * from, so a system that declares a characteristic gets a stored field for it
 * without a schema edit.
 */
export function characteristicKeys(
	registry: CharacteristicRegistry = activeRegistry,
): readonly string[] {
	return registry.keys;
}

/**
 * The registry's SHORT label map, in book order — key -> i18n label key
 * (`"ws"` -> `"CHARACTERISTIC.WS"`).
 *
 * This map IS Foundry's `choices` shape (`StringField#choices`, `selectOptions`),
 * so the registry seed (`src/roguetrader/registry.ts`) and every
 * `characteristicChoices` getter read the same generated object; there is no
 * second table to keep in step.
 */
export function characteristicChoices(
	registry: CharacteristicRegistry = activeRegistry,
): Record<string, string> {
	return Object.fromEntries(
		registry.keys.map((key) => [
			key,
			`${registry.labelPrefix}.${key.toUpperCase()}`,
		]),
	);
}
