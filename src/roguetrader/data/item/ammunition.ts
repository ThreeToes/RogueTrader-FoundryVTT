import { Gear } from "./gear";

/** Ammunition: consumable rounds for weapons (extends Gear's trade fields). */
export class Ammunition extends Gear {
	static LOCALIZATION_PREFIXES = ["AMMUNITION"];

	declare quantity: number;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			quantity: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
		};
	}
}
