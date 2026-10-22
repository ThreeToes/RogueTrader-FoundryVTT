/**
 * Shared effect-list SCHEMA for items whose effects are data consumed by the
 * rules layer (bead yb6). Talents pioneered the shape; gear, weapons and
 * armour share it so pack entries can carry live mechanical effects without
 * per-type schema forks.
 *
 * The plain shape (`EffectData`) and every pure helper over it moved to the
 * domain model (`domain/model/effect.ts`) in phase 1 and are re-exported here
 * for compatibility. This module now holds only the Foundry schema factory.
 */
import { effectKinds } from "../../../ffg/domain/effects";
import { talentEffectHandlers } from "../../rules/talent-effects";
import { textField } from "../fields";

export {
	blankEffect,
	corruptionExpressions,
	type EffectData,
	effectsAreLive,
	withAddedEffect,
	withoutEffectAt,
} from "../../../ffg/domain/model/effect";

/**
 * Schema choices for the effect row's `kind` (bead 4398); derived from the
 * ONE registry union the editor dropdown uses (specs' kinds + handler-only
 * kinds), with the spec's `labelKey` as the stored label. An AUTHORED kind
 * that no spec or handler registers now fails validation loudly instead of
 * rendering its raw slug. Blank stays tolerated (old behaviour): the
 * collector normalises a blank kind to "test-modifier".
 */
function effectKindSchemaChoices(): Record<string, string> {
	const kinds = new Set([
		...effectKinds.all().map((spec) => spec.kind),
		...talentEffectHandlers.kinds(),
	]);
	const out: Record<string, string> = {};
	for (const kind of [...kinds]) {
		out[kind] = effectKinds.get(kind)?.labelKey ?? kind;
	}
	return out;
}

/** Schema factory for the effect list; identical shape across item types. */
export function effectsField() {
	return new foundry.data.fields.ArrayField(
		new foundry.data.fields.SchemaField({
			kind: new foundry.data.fields.StringField({
				initial: "test-modifier",
				required: true,
				nullable: false,
				// `choices` flips the StringField blank default to false (same
				// rule as careerKey/sorceryRank) — keep the old blank tolerance.
				blank: true,
				// FUNCTION form (bead dkh9): Foundry caches a DataModel's schema
				// on first access, so an eager call here froze the kind choices
				// at first materialisation — a module registering a new kind
				// post-boot passed the editor dropdown but was REJECTED at
				// validation. As a function, StringField evaluates the choices
				// at validation time, so late registrations stay valid.
				choices: () => effectKindSchemaChoices(),
			}),
			testKey: textField(),
			value: new foundry.data.fields.NumberField({
				integer: true,
				initial: 0,
			}),
			/** Dice expression (epic 0hap): used by dice-valued kinds like
			 * "corruption" where the book prints "1d10+4" rather than a flat
			 * number. Empty = fall back to `value`. */
			dice: textField(),
			label: textField(),
			condition: textField(),
		}),
		{ initial: () => [] },
	);
}
