import { equipStates } from "../../registry";
import { Availability, normalizeAvailability } from "./availability";
import { Craftsmanship } from "./craftsmanship";
import { effectsField } from "./effects";
import { sourceField } from "./source";

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
			/**
			 * Stack count (bead 1sxq, owner decision 2026-10-02): every physical
			 * item family inherits quantity from this Gear base. An item exists
			 * at quantity 1; 0 means spent/depleted (e.g. fired ordnance).
			 * Introduced for the launcher-ammunition usage epic — grenade
			 * weapons count as consumable ordnance that depletes with use —
			 * but it is a general Items field, not launcher-specific:
			 * homebrewers can stack any physical item.
			 */
			quantity: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 1,
				required: true,
			}),
			shortDescription: new foundry.data.fields.StringField(),
			description: new foundry.data.fields.HTMLField(),
			effects: effectsField(),
			// Source attribution (bead zzlq): books.yaml slug + printed page.
			source: sourceField(),
		};
	}
}
