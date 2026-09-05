import { talentCategories } from "../../registry";
import { effectsField, type EffectData } from "./effects";

/**
 * Talents as Items (content-as-data, mirroring Skill): actors own `talent`
 * Items; the catalog lives in registries (CONFIG.ROGUE_TRADER.talents /
 * talentCategories) so modules extend content at init.
 *
 * Mechanical effects are DATA, not logic: a flat list of effect contributions
 * (shared shape, see data/item/effects.ts) that the rules layer's funnel
 * contributor (rules/funnel.ts type "item-effects") reads and converts to
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
	/** Long prose description (rulebook talent descriptions, p93-99). */
	declare description: string;
	declare effects: EffectData[];

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
			effects: effectsField(),
			/** Short free-text description shown in pickers. */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * Long prose description (bead 707 decision: talents carry BOTH the
			 * terse table benefit AND the full rulebook prose). HTML so the
			 * prose-mirror notes tab round-trips; the compendium packer nests the
			 * pack entry's top-level `description` here.
			 */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			/**
			 * Provenance marker (bead iufv): "creator" when the character
			 * creator granted this item — a creator re-run wipes and re-grants
			 * flagged items, manual additions (empty) are kept.
			 */
			grantedBy: new foundry.data.fields.StringField({
				initial: "",
			}),
		};
	}

	/** Effects fed to the test-modifier handler matching a characteristic key (or empty = all). */
	effectsForKind(kind: string): Array<{
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
