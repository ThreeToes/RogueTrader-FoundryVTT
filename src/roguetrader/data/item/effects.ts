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

export {
	blankEffect,
	corruptionExpressions,
	type EffectData,
	effectsAreLive,
	withAddedEffect,
	withoutEffectAt,
} from "../../domain/model/effect";

/** Schema factory for the effect list; identical shape across item types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Talent's inferred field type
export function effectsField() {
	return new foundry.data.fields.ArrayField(
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
			/** Dice expression (epic 0hap): used by dice-valued kinds like
			 * "corruption" where the book prints "1d10+4" rather than a flat
			 * number. Empty = fall back to `value`. */
			dice: new foundry.data.fields.StringField({
				initial: "",
			}),
			label: new foundry.data.fields.StringField({
				initial: "",
			}),
			condition: new foundry.data.fields.StringField({
				initial: "",
			}),
		}),
		{ initial: () => [] },
	);
}
