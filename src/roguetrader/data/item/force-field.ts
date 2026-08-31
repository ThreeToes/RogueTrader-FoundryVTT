import { Gear } from "./gear";

/**
 * Force field: worn protective device. Protection rating is added to armour
 * against hits; overload chance is the per-hit chance the field burns out
 * (VERIFY exact book rule before wiring into the damage flow).
 */
export class ForceField extends Gear {
	static LOCALIZATION_PREFIXES = ["FORCE_FIELD"];

	declare protection: number;
	declare overloadChance: number;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			protection: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			overloadChance: new foundry.data.fields.NumberField({
				min: 0,
				max: 100,
				integer: true,
				initial: 0,
				required: true,
			}),
		};
	}
}
