import { Weapon, WeaponQuality } from "./weapon";
import { RANGED_CLASSES, WeaponClass } from "./weapon-class";

export type { WeaponQuality };
/**
 * Ranged weapon: a Weapon with ammunition management.
 */
export class RangedWeapon extends Weapon {
	static LOCALIZATION_PREFIXES = ["RANGED_WEAPON", "WEAPON"];

	static override defineSchema() {
		return {
			...super.defineSchema(),
			class: new foundry.data.fields.StringField({
				choices: RANGED_CLASSES,
				initial: WeaponClass.Basic,
				required: true,
				nullable: false,
			}),
			rateOfFire: new foundry.data.fields.SchemaField({
				singleShot: new foundry.data.fields.BooleanField({ initial: true }),
				burst: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
				fullAuto: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
			}),
			clip: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			reload: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
		};
	}
}
