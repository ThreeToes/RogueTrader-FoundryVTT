import { describe, expect, test } from "bun:test";
// The stub must be evaluated before any schema factory touches `foundry.*`:
// it is imported ahead of the modules that create fields.
import "../../../test-helpers/foundry-schema-stub";
import { effectKinds } from "../../../ffg/domain/effects";
import {
	blankEffect,
	corruptionExpressions,
	effectsAreLive,
	effectsField,
	withAddedEffect,
	withoutEffectAt,
	type EffectData,
} from "./effects";

describe("effect list helpers (sheets' add/remove controls)", () => {
	test("blankEffect mirrors the schema defaults", () => {
		expect(blankEffect()).toEqual({
			kind: "test-modifier",
			testKey: "",
			value: 0,
			dice: "",
			label: "",
			condition: "",
		});
	});

	test("withAddedEffect appends a blank row without mutating the input", () => {
		const existing: EffectData[] = [
			{
				kind: "test-modifier",
				testKey: "bs",
				value: 5,
				label: "X",
				condition: "",
			},
		];
		const result = withAddedEffect(existing);
		expect(result).toHaveLength(2);
		expect(result[1]).toEqual(blankEffect());
		expect(existing).toHaveLength(1);
	});

	test("withAddedEffect handles undefined effects (fresh items)", () => {
		expect(withAddedEffect(undefined)).toEqual([blankEffect()]);
	});

	test("withoutEffectAt removes only the indexed row", () => {
		const list: EffectData[] = [
			{
				kind: "test-modifier",
				testKey: "",
				value: 1,
				label: "a",
				condition: "",
			},
			{
				kind: "test-modifier",
				testKey: "",
				value: 2,
				label: "b",
				condition: "",
			},
			{
				kind: "test-modifier",
				testKey: "",
				value: 3,
				label: "c",
				condition: "",
			},
		];
		expect(withoutEffectAt(list, 1).map((e) => e.label)).toEqual(["a", "c"]);
		// Out-of-range indices leave the list untouched.
		expect(withoutEffectAt(list, 99)).toHaveLength(3);
	});

	describe("corruptionExpressions (epic 0hap)", () => {
		test("collects dice expressions from corruption rows", () => {
			expect(
				corruptionExpressions([
					{ kind: "corruption", dice: "1d10+4" },
					{ kind: "test-modifier", dice: "1d5" },
					{ kind: "corruption", value: 2 },
				]),
			).toEqual(["1d10+4", "2"]);
		});

		test("ignores blanks and absent effects", () => {
			expect(corruptionExpressions(undefined)).toEqual([]);
			expect(
				corruptionExpressions([{ kind: "corruption", dice: "  " }]),
			).toEqual([]);
		});
	});
});

describe("effectsAreLive (epic nt8k)", () => {
	test("afflictions are innate: owned means live, no equip state", () => {
		expect(effectsAreLive("mutation", undefined)).toBe(true);
		expect(effectsAreLive("madnessentry", undefined)).toBe(true);
		expect(effectsAreLive("madnessentry", "stowed")).toBe(true);
	});

	test("physical items still require their equip state", () => {
		expect(effectsAreLive("gear", "stowed")).toBe(false);
		expect(effectsAreLive("gear", "carried")).toBe(true);
	});
});

describe("effectsField kind choices (bead 4398, dkh9)", () => {
	// Materialise the schema ONCE here, before any test mutates the registry:
	// the whole point of dkh9 is that a kind registered AFTER this build is
	// still accepted by the field's (now function-form) choices.
	const kindField = (() => {
		const array = effectsField() as unknown as { of: unknown };
		const schema = array.of as { fields: Record<string, unknown> };
		return schema.fields.kind as unknown as {
			opts: {
				choices: () => Record<string, string>;
				blank?: boolean;
			};
		};
	})();

	/** Evaluate the field's choices — the function Foundry calls at
	 * validation time (StringField._isValidChoice). */
	const choicesNow = (): Record<string, string> => {
		const choices = kindField.opts.choices;
		expect(typeof choices).toBe("function");
		return choices();
	};

	test("choices are the FUNCTION form, not an eagerly-frozen snapshot", () => {
		expect(typeof kindField.opts.choices).toBe("function");
	});

	test("the kind field constrains to the registered kinds, labels = labelKeys", () => {
		const choices = choicesNow();
		for (const spec of effectKinds.all()) {
			expect(choices[spec.kind], spec.kind).toBe(spec.labelKey);
		}
	});

	test("fear-immunity and fear-reroll are offered (bead 4398)", () => {
		const choices = choicesNow();
		expect(choices["fear-immunity"]).toBe(
			"EFFECT_KIND.FEAR_IMMUNITY",
		);
		expect(choices["fear-reroll"]).toBe(
			"EFFECT_KIND.FEAR_REROLL",
		);
	});

	test("blank stays tolerated (normalised to test-modifier)", () => {
		expect(kindField.opts.blank).toBe(true);
	});

	// The dkh9 pin: the registry seam's documented path is a module that
	// registers a new kind AFTER the first item-model materialisation. The
	// schema is already built (the kindField IIFE above ran before this test),
	// so under the OLD eager `choices` snapshot this kind would be rejected at
	// validation and brick the item's sheet save.
	test("a kind registered AFTER schema materialisation is accepted (bead dkh9)", () => {
		const LATE_KIND = "late-schema-kind";
		try {
			effectKinds.register({ kind: LATE_KIND, channels: ["test"] });
			// The schema was built by the kindField IIFE above; the choices
			// function must still surface (and thus accept) the late kind.
			expect(choicesNow()[LATE_KIND]).toBe(LATE_KIND);
		} finally {
			effectKinds.unregister(LATE_KIND);
		}
		// And restoring: the late kind is gone again after the finally.
		expect(choicesNow()[LATE_KIND]).toBeUndefined();
	});
});
