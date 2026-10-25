/**
 * The characteristic-vocabulary registry seam (epic w9sa, bead w9sa.10).
 *
 * The nine characteristic keys used to be hand-listed in the Character
 * DataModel schema AND in `registry.ts`; a sibling system's tenth characteristic
 * would have drifted between them. These tests pin the derivation to the
 * profile's `characteristics.keys`, the byte-identical RT output, and the loud
 * refusals, so the one source cannot quietly grow a second copy again.
 *
 * Pure data and pure functions: no Foundry, no ports (the architecture boundary
 * gate in `src/roguetrader/architecture.test.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test";

import { rtCore } from "../system-profile";
import {
	type CharacteristicRegistry,
	type CharacteristicVocabularySource,
	characteristicChoices,
	characteristicKeys,
	characteristicRegistry,
	characteristicRegistryFor,
	RT_CHARACTERISTIC_REGISTRY,
	registerCharacteristicRegistry,
	resetCharacteristicRegistryForTests,
} from "./characteristic-registry";
import { CHARACTERISTIC_KEYS } from "./taxonomy";

// The binding is module-global and bun runs every suite in ONE process, so a
// leaked sibling registry would build every later RT suite's schema and pickers
// from the wrong vocabulary — the discipline the knob and taxonomy registries
// guard with their own resets.
afterEach(() => {
	resetCharacteristicRegistryForTests();
});

/** A sibling registry that is deliberately NOT RT's: two RT keys plus one of its
 * own, so the derivation cannot be passing by accident. */
const SIBLING_REGISTRY: CharacteristicRegistry = characteristicRegistryFor(
	"sibling-system",
	{
		characteristics: {
			keys: ["ws", "bs", "grit"],
			labelPrefix: "CHARACTERISTIC",
		},
	},
);

describe("the default binding is Rogue Trader's own vocabulary", () => {
	test("the seam defaults to RT, exactly as the knob and taxonomy registries do", () => {
		expect(characteristicRegistry()).toBe(RT_CHARACTERISTIC_REGISTRY);
		expect(RT_CHARACTERISTIC_REGISTRY.systemId).toBe("rogue-trader");
	});

	test("RT's keys come from rtCore, in book order, byte-identical", () => {
		// The profile is the ONE source: nothing is restated in the registry.
		expect(RT_CHARACTERISTIC_REGISTRY.keys).toEqual(
			rtCore.characteristics?.keys,
		);
		expect(RT_CHARACTERISTIC_REGISTRY.keys).toEqual([
			"ws",
			"bs",
			"s",
			"t",
			"ag",
			"int",
			"per",
			"wp",
			"fel",
		]);
		// And it still matches the kernel vocabulary RT's rules iterate, so the
		// registry and CHARACTERISTIC_KEYS cannot drift apart unnoticed.
		expect(RT_CHARACTERISTIC_REGISTRY.keys).toEqual([...CHARACTERISTIC_KEYS]);
		expect(RT_CHARACTERISTIC_REGISTRY.labelPrefix).toBe(
			rtCore.characteristics?.labelPrefix,
		);
	});

	test("RT's short label map is unchanged, verbatim from the replaced table", () => {
		expect(characteristicChoices(RT_CHARACTERISTIC_REGISTRY)).toEqual({
			ws: "CHARACTERISTIC.WS",
			bs: "CHARACTERISTIC.BS",
			s: "CHARACTERISTIC.S",
			t: "CHARACTERISTIC.T",
			ag: "CHARACTERISTIC.AG",
			int: "CHARACTERISTIC.INT",
			per: "CHARACTERISTIC.PER",
			wp: "CHARACTERISTIC.WP",
			fel: "CHARACTERISTIC.FEL",
		});
	});

	test("the label map keeps the registry's book order", () => {
		expect(
			Object.keys(characteristicChoices(RT_CHARACTERISTIC_REGISTRY)),
		).toEqual([...RT_CHARACTERISTIC_REGISTRY.keys]);
	});
});

describe("a sibling registry derives its own schema, map and choices", () => {
	test("keys are the sibling's, not RT's", () => {
		expect(characteristicKeys(SIBLING_REGISTRY)).toEqual(["ws", "bs", "grit"]);
	});

	test("short labels compose from the registry's own prefix", () => {
		expect(characteristicChoices(SIBLING_REGISTRY)).toEqual({
			ws: "CHARACTERISTIC.WS",
			bs: "CHARACTERISTIC.BS",
			grit: "CHARACTERISTIC.GRIT",
		});
	});

	test("a different label prefix produces a different label vocabulary", () => {
		const prefixed = characteristicRegistryFor("sibling-system", {
			characteristics: { keys: ["ws"], labelPrefix: "CHARACTERISTIC_ALT" },
		});
		expect(characteristicChoices(prefixed)).toEqual({
			ws: "CHARACTERISTIC_ALT.WS",
		});
	});

	test("registering a sibling registry swaps every reader, and reset restores RT", () => {
		registerCharacteristicRegistry(SIBLING_REGISTRY);
		expect(characteristicRegistry()).toBe(SIBLING_REGISTRY);
		expect(characteristicKeys()).toEqual(characteristicKeys(SIBLING_REGISTRY));
		expect(characteristicChoices()).toEqual(
			characteristicChoices(SIBLING_REGISTRY),
		);
		resetCharacteristicRegistryForTests();
		expect(characteristicRegistry()).toBe(RT_CHARACTERISTIC_REGISTRY);
		expect(characteristicKeys()).toEqual(RT_CHARACTERISTIC_REGISTRY.keys);
	});
});

describe("a vocabulary that would build a silently wrong schema is refused", () => {
	const system = "sibling-system";

	test("no characteristics block raises, naming the system", () => {
		expect(() =>
			characteristicRegistryFor(system, {} as CharacteristicVocabularySource),
		).toThrow(/sibling-system.*no characteristic vocabulary/);
	});

	test("an empty vocabulary raises instead of producing a schema with no fields", () => {
		expect(() =>
			characteristicRegistryFor(system, {
				characteristics: { keys: [], labelPrefix: "CHARACTERISTIC" },
			}),
		).toThrow(/empty characteristic vocabulary/);
	});

	test("a duplicate key raises instead of one field overwriting another", () => {
		expect(() =>
			characteristicRegistryFor(system, {
				characteristics: { keys: ["ws", "ws"], labelPrefix: "CHARACTERISTIC" },
			}),
		).toThrow(/characteristic key "ws" twice/);
	});
});

describe("the registry copies the profile's declaration", () => {
	test("a registry cannot mutate the profile's keys array", () => {
		const source: CharacteristicVocabularySource = {
			characteristics: { keys: ["ws"], labelPrefix: "CHARACTERISTIC" },
		};
		const registry = characteristicRegistryFor("sibling-system", source);
		const keys = registry.keys as string[];
		keys.push("grit");
		expect(source.characteristics?.keys).toEqual(["ws"]);
		expect(registry.keys).toEqual(["ws", "grit"]);
	});
});
