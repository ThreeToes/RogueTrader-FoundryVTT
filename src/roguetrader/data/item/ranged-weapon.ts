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
			// This schema is the source of truth for the rate of fire; the READ
			// shape is declared once as `RateOfFire` (data/item/rate-of-fire.ts),
			// which the sheets import rather than re-declaring these fields.
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
			/** Reload time in book notation: "Full", "2 Full", "Half", "—". */
			reload: new foundry.data.fields.StringField({
				required: true,
				initial: "—",
			}),
		};
	}
}
