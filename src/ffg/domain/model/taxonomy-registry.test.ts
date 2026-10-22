/**
 * The item-taxonomy registry seam (epic cmio, bead cmio.5 — audit finding A4).
 *
 * Effect liveness, the intrinsic-attack gate and the funnel source labels are
 * the ACTIVE system's registry data; a foreign (undeclared) item type is a
 * loud RangeError naming the type, never a silently dead item. Pure data and
 * pure functions, so no Foundry, no ports — the rule-knobs test's gate plan.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { attackProfileOf } from "./attack";
import { effectsAreLive } from "./effect";
import {
	type ItemTaxonomyRegistry,
	itemTaxonomyRegistry,
	registerItemTaxonomyRegistry,
	requireDeclaredItemType,
	resetItemTaxonomyRegistryForTests,
	RT_ITEM_TAXONOMY_REGISTRY,
	RT_SOURCE_LABELS,
} from "./taxonomy-registry";

// The binding is module-global and bun runs every suite in ONE process, so a
// leaked foreign registry would quietly retune the RT suites that run later —
// the same discipline resetRuleKnobRegistryForTests guards on.
afterEach(() => {
	resetItemTaxonomyRegistryForTests();
});

/** A DH2-shaped sibling registry for the swap tests. The item types are
 * deliberately NOT RT's (no "mutation", a foreign "psychicdiscipline") so the
 * refusal paths run against real foreign types. */
const SIBLING_SYSTEM_ID = "dark-heresy-2e";

const SIBLING_TAXONOMY: ItemTaxonomyRegistry = {
	systemId: SIBLING_SYSTEM_ID,
	declaredItemTypes: ["talent", "gear", "psychicdiscipline"],
	innateEffectTypes: ["talent", "psychicdiscipline"],
	equipStatesForEffects: { gear: ["carried"] },
	intrinsicAttackTypes: ["melee-weapon", "psychicdiscipline"],
	sourceLabels: {
		talent: "SOURCE.FROM_TALENTS",
		gear: "SOURCE.FROM_GEAR",
		psychicdiscipline: "SOURCE.FROM_POWERS",
	},
};

describe("the default binding is Rogue Trader's own taxonomy", () => {
	test("the seam defaults to RT, exactly as the knob registry does", () => {
		const registry = itemTaxonomyRegistry();
		expect(registry.systemId).toBe("rogue-trader");
		expect(registry).toBe(RT_ITEM_TAXONOMY_REGISTRY);
	});

	test("RT's innate set is unchanged, verbatim from model/effect.ts", () => {
		// Talents and psychic powers are "known"; traits, mutations and
		// madness entries are innate conditions the actor always has.
		expect(itemTaxonomyRegistry().innateEffectTypes).toEqual([
			"talent",
			"psychicpower",
			"trait",
			"mutation",
			"madnessentry",
		]);
	});

	test("RT's equip-liveness table is unchanged, verbatim", () => {
		expect(itemTaxonomyRegistry().equipStatesForEffects).toEqual({
			armour: ["worn"],
			gear: ["carried"],
			"melee-weapon": ["carried"],
			"ranged-weapon": ["carried"],
		});
	});

	test("RT's intrinsic-attack set is unchanged: weapons + mutation", () => {
		expect(itemTaxonomyRegistry().intrinsicAttackTypes).toEqual([
			"melee-weapon",
			"ranged-weapon",
			"mutation",
		]);
	});

	test("RT's source labels are unchanged, verbatim from effects/specs.ts", () => {
		expect(itemTaxonomyRegistry().sourceLabels).toEqual(RT_SOURCE_LABELS);
		expect(itemTaxonomyRegistry().sourceLabels).toEqual({
			talent: "SOURCE.FROM_TALENTS",
			trait: "SOURCE.FROM_TRAITS",
			mutation: "SOURCE.FROM_MUTATIONS",
			madnessentry: "SOURCE.FROM_AFFLICTIONS",
			armour: "SOURCE.FROM_ARMOUR",
			gear: "SOURCE.FROM_GEAR",
			"melee-weapon": "SOURCE.FROM_WEAPONS",
			"ranged-weapon": "SOURCE.FROM_WEAPONS",
		});
	});
});

describe("the declared vocabulary covers every set the registry carries", () => {
	const registry = itemTaxonomyRegistry();

	test("innate types are a subset of declaredItemTypes", () => {
		for (const type of registry.innateEffectTypes) {
			expect(registry.declaredItemTypes).toContain(type);
		}
	});

	test("equip-liveness types are a subset of declaredItemTypes", () => {
		for (const type of Object.keys(registry.equipStatesForEffects)) {
			expect(registry.declaredItemTypes).toContain(type);
		}
	});

	test("intrinsic-attack types are a subset of declaredItemTypes", () => {
		for (const type of registry.intrinsicAttackTypes) {
			expect(registry.declaredItemTypes).toContain(type);
		}
	});
});

describe("a foreign item type is refused BY NAME", () => {
	test("effectsAreLive throws naming the undeclared type (was silently dead)", () => {
		expect(() => effectsAreLive("void-power", undefined)).toThrow(
			/void-power/,
		);
	});

	test("the refusal also names the active system and its vocabulary", () => {
		expect(() => requireDeclaredItemType("void-power")).toThrow(
			new RegExp(
				`"void-power".*not declared.*"rogue-trader".*talent`.replaceAll(
					" ",
					"\\s*",
				),
				"s",
			),
		);
	});

	test("attackProfileOf throws naming the undeclared type", () => {
		expect(() =>
			attackProfileOf({
				name: "Strangler Vine",
				type: "void-power",
				system: {
					attack: { characteristic: "bs", damage: "1d10" },
				},
			}),
		).toThrow(/void-power/);
	});

	test("a blank type stays tolerated (no type = no effects, no attack)", () => {
		expect(effectsAreLive(undefined, "carried")).toBe(false);
		expect(effectsAreLive("", "carried")).toBe(false);
		expect(attackProfileOf({ name: "Nameless", type: "", system: {} })).toBe(
			null,
		);
		expect(attackProfileOf(null)).toBe(null);
	});
});

describe("a DECLARED type without a role stays quiet", () => {
	// The declared vocabulary is what makes the refusal precise: RT declares
	// navigatorpower, so its items must behave exactly as before — never an
	// effect contribution and never an attack — because the system author
	// decided so. Only truly undeclared types throw.
	test("a navigator power has no live effects and no attack", () => {
		expect(effectsAreLive("navigatorpower", undefined)).toBe(false);
		expect(
			attackProfileOf({
				name: "Void-Sense",
				type: "navigatorpower",
				system: {},
			}),
		).toBe(null);
	});

	test("a skill contributes no effects", () => {
		expect(effectsAreLive("skill", "carried")).toBe(false);
	});
});

describe("the seam swaps, and the machinery follows it", () => {
	test("one call points liveness, attacks and labels at the sibling", () => {
		registerItemTaxonomyRegistry(SIBLING_TAXONOMY);

		// The sibling's innate set governs.
		expect(effectsAreLive("psychicdiscipline", undefined)).toBe(true);
		expect(effectsAreLive("psychicdiscipline", "stowed")).toBe(true);
		expect(effectsAreLive("gear", "carried")).toBe(true);
		expect(effectsAreLive("gear", "stowed")).toBe(false);

		// The sibling's intrinsic-attack set governs: a psychic discipline
		// carrying an attack block resolves through the same profile shape a
		// mutation does, innate to the body.
		const attack = attackProfileOf({
			name: "Psyonic Crush",
			type: "psychicdiscipline",
			system: {
				attack: { characteristic: "wp", damage: "2d10", damageTypes: ["E"] },
			},
		});
		expect(attack?.innate).toBe(true);
		expect(attack?.characteristic).toBe("wp");

		// ...and an RT type the sibling does not declare is now refused, which
		// is exactly what protected a DH2-shaped system from RT drift.
		expect(() => effectsAreLive("mutation", undefined)).toThrow(/mutation/);
	});

	test("the reset restores RT, so no suite leaks a foreign registry", () => {
		registerItemTaxonomyRegistry(SIBLING_TAXONOMY);
		resetItemTaxonomyRegistryForTests();
		expect(itemTaxonomyRegistry()).toBe(RT_ITEM_TAXONOMY_REGISTRY);
		expect(effectsAreLive("mutation", undefined)).toBe(true);
	});
});