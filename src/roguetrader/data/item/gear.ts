import { Availability } from "./availability";
import { Craftsmanship } from "./craftsmanship";

export class Gear extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["GEAR"];

	static defineSchema() {
		return {
			availability: new foundry.data.fields.StringField({
				choices: Object.values(Availability),
				initial: Availability.Common,
				required: true,
				nullable: false,
			}),
			craftsmanship: new foundry.data.fields.StringField({
				choices: Object.values(Craftsmanship),
				initial: Craftsmanship.Common,
				required: true,
				nullable: false,
			}),
			weight: new foundry.data.fields.NumberField({
				min: 0,
				initial: 0,
				required: true,
			}),
			shortDescription: new foundry.data.fields.StringField(),
			description: new foundry.data.fields.HTMLField(),
		};
	}
}
