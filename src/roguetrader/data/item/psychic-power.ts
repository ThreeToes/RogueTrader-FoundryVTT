import { DamageType } from "./damage-types";

/** Psychic power sub-types (RT core, VERIFY against the book when seeding). */
export const psychicPowerSubtypes = [
	"focus",
	"bolt",
	"barrage",
	"storm",
	"zone",
] as const;

/** Power class: bound (safe, disciplined) vs unbound (raw, pushable). */
export const psychicPowerClasses = ["bound", "unbound"] as const;

/**
 * Psychic powers as Items (mirrors Talent): actors own `psychicpower` Items;
 * the catalog lives in compendium packs. Mechanical use in the attack/test
 * flow comes later; for now this is the content schema the pack needs.
 */
export class PsychicPower extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["PSYCHIC_POWER"];

	declare prerequisite: string;
	declare powerClass: string;
	declare subtype: string;
	declare rating: number;
	declare range: string;
	declare damage: string;
	declare damageType: string;
	declare sustained: boolean;
	declare shortDescription: string;

	static override defineSchema() {
		return {
			/** Free-text prerequisite (e.g. "WP 40, Discipline (Telepathy)"). */
			prerequisite: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Bound vs unbound discipline. */
			powerClass: new foundry.data.fields.StringField({
				choices: psychicPowerClasses,
				initial: "bound",
				required: true,
				nullable: false,
			}),
			/** Focus / bolt / barrage / storm / zone. */
			subtype: new foundry.data.fields.StringField({
				choices: psychicPowerSubtypes,
				initial: "focus",
				required: true,
				nullable: false,
			}),
			/** Psy rating multiplier or flat rating captured raw. */
			rating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Range expression, e.g. "10 x PR m" (free text, book varies). */
			range: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Damage expression, e.g. "1d10+5 E". */
			damage: new foundry.data.fields.StringField({
				initial: "",
			}),
			damageType: new foundry.data.fields.StringField({
				choices: Object.values(DamageType),
				initial: DamageType.Energy,
				required: true,
				nullable: false,
			}),
			/** Sustained powers stay active across rounds. */
			sustained: new foundry.data.fields.BooleanField({
				initial: false,
			}),
			/** Short free-text description shown in pickers. */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
		};
	}
}
