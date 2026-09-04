import { talentCategories } from "../../registry";

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
	declare tier: number;
	declare prereqTalent: string;
	declare shortDescription: string;
	declare effects: Array<{
		kind: string;
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
			 * Effect list: {kind, testKey, value, label}. `kind` selects which
			 * registered talentEffectHandler consumes the entry ("test-modifier"
			 * is the funnel contributor default; other kinds are registered
			 * handler kinds, e.g. "wounds-max"). Raw capture only.
			 */
			/**
			 * Tier (1 = basic) and prerequisite talent registry key. Used by the
			 * picker for chain gating (canGrant); rules themselves are data,
			 * chains are defined by authors/modules. (VERIFY per-talent prereq
			 * rules against the book before extending the seed.)
			 */
			tier: new foundry.data.fields.NumberField({
				min: 1,
				integer: true,
				initial: 1,
			}),
			prereqTalent: new foundry.data.fields.StringField({
				initial: "",
			}),
			effects: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					kind: new foundry.data.fields.StringField({
						initial: "test-modifier",
						required: true,
						nullable: false,
					}),
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

	/** Effects fed to the test-modifier handler matching a characteristic key (or empty = all). */
	effectsForKind(
		kind: string,
	): Array<{
		kind: string;
		testKey: string | null;
		value: number;
		label: string;
	}> {
		return (this.effects ?? []).filter((effect) => effect.kind === kind);
	}

	/**
	 * Whether this talent can be granted given owned talent registry keys:
	 * met when there is no prerequisite, or when the prerequisite key is
	 * among the owned set. Pure + testable.
	 */
	static canGrant(
		prereqTalent: string | undefined,
		ownedPrereqKeys: ReadonlySet<string>,
	): boolean {
		if (!prereqTalent) return true;
		return ownedPrereqKeys.has(prereqTalent);
	}
}
