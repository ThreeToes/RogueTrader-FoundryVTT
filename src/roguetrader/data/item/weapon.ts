import { qualities } from "../../registry";
import { Gear } from "./gear";
import { WeaponClass } from "./weapon-class";

/**
 * Placeholder for weapon qualities (e.g. Accurate, Tearing).
 * TODO: flesh out into a proper schema once weapon qualities are modelled.
 */
export interface WeaponQuality {
	name: string;
	rating?: number;
}

/**
 * Common behaviour and data shared by all weapon types (melee, ranged).
 */
export abstract class Weapon extends Gear {
	static LOCALIZATION_PREFIXES = ["WEAPON"];

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Weapon class, e.g. pistol/basic/heavy/thrown/melee. */
			class: new foundry.data.fields.StringField({
				choices: Object.values(WeaponClass),
				initial: WeaponClass.Melee as WeaponClass,
				required: true,
				nullable: false,
			}),
			/** Effective range in metres. */
			range: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			/** Damage formula, e.g. "1d10+4 E". */
			damage: new foundry.data.fields.StringField({
				required: true,
				initial: "",
			}),
			penetration: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			special: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField({
					choices: qualities.choices,
					required: true,
					nullable: false,
					initial: "",
				}),
			),
		};
	}
}
