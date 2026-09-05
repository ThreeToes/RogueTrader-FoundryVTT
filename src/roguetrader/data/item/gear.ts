import { equipStates } from "../../registry";
import { Availability, normalizeAvailability } from "./availability";
import { Craftsmanship } from "./craftsmanship";
import { effectsField } from "./effects";

export class Gear extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["GEAR"];

	static defineSchema() {
		return {
			availability: new foundry.data.fields.StringField({
				// NO `choices` here (bead h7wl follow-up): Foundry validates
				// choices against the RAW source before `clean` runs at document
				// init, so a capitalized legacy value ("Common") bricks the item
				// with a DataModelValidationError instead of being normalized.
				// Dropdowns take their options from the `config` helper
				// (sheet/config.ts); clean normalizes legacy values at
				// initialize/save with a console warning for unknowns.
				initial: Availability.Common,
				required: true,
				nullable: false,
				clean: normalizeAvailability,
			}),
			/**
			 * Carrying state (item-side equip model): stowed / carried for
			 * weapons+gear, worn for armour. Existing items default to stowed
			 * via schema initial (no migration script needed; attacks require
			 * the weapon to be carried, see rules/adapter). Modules add states
			 * via CONFIG.ROGUE_TRADER.equipStates at init.
			 */
			equipState: new foundry.data.fields.StringField({
				choices: equipStates.choices,
				initial: "stowed",
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
			effects: effectsField(),
		};
	}
}
