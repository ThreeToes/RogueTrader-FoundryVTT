import { Weapon } from "./weapon";
import { MELEE_CLASSES, WeaponClass } from "./weapon-class";

/**
 * Melee weapon: a Weapon without ammunition management.
 */
export class MeleeWeapon extends Weapon {
	static LOCALIZATION_PREFIXES = ["WEAPON"];

	declare class: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			class: new foundry.data.fields.StringField({
				choices: MELEE_CLASSES,
				initial: WeaponClass.Melee,
				required: true,
				nullable: false,
			}),
		};
	}
}
