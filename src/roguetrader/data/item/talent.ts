import { talents, talentCategories } from "../../registry";

/**
 * Talents as Items (content-as-data, mirroring Skill): actors own `talent`
 * Items; the catalog lives in registries (CONFIG.ROGUE_TRADER.talents /
 * talentCategories) so modules extend content at init.
 *
 * Mechanical effects are DATA, not logic: a flat list of test-modifier
 * contributions {@link testModifiers} that the rules layer's funnel
 * contributor (rules/funnel.ts type "talent") reads and converts to
 * Modifier[] for every applicable test. Non-modifier effects (extra wounds,
 * rank grants, ...) are deliberately not schema - model them later as
 * registered contribution types as they are needed.
 */
export class Talent extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["TALENT"];

	declare category: string;
	declare effects: Array<{
		testKey: string | null;
		value: number;
		label: string;
	}>;

	static get categoryChoices(): Record<string, string> {
		return talentCategories.choices;
	}

	static override defineSchema() {
		return {
			/** Grouping bucket from the talentCategories registry. */
			category: new foundry.data.fields.StringField({
				choices: Talent.categoryChoices,
				initial: "background",
				required: true,
				nullable: false,
			}),
			/**
			 * Test-modifier effects: {testKey: characteristic key or null for
			 * all tests, value: additive modifier, label: breakdown text}.
			 * Raw capture only - the funnel contributor maps these to
			 * Modifier[] per test kind. Non-modifier effects are future work.
			 */
			effects: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					testKey: new foundry.data.fields.StringField({
						initial: "",
					}),
					value: new foundry.data.fields.NumberField({
						integer: true,
						initial: 0,
					}),
					label: new foundry.data.fields.StringField({
						initial: "",
					}),
				}),
				{ initial: () => [] },
			),
			/** Short free-text description shown in pickers. */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
		};
	}

	/** Effects matching a test's characteristic key (or null-testKey for all). */
	effectsWithTestKey(testKey: string): Array<{
		testKey: string;
		value: number;
		label: string;
	}> {
		return (this.effects ?? []).filter(
			(effect) => effect.testKey === "" || effect.testKey === testKey,
		);
	}
}