import { Weapon } from "./weapon";

/**
 * Melee weapon: a Weapon without ammunition management.
 */
export class MeleeWeapon extends Weapon {
	static LOCALIZATION_PREFIXES = ["WEAPON"];
}