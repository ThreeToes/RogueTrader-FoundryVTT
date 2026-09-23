import { Gear } from "./gear";
import { textField } from "../fields";

/**
 * Weapon modification: an upgrade attached to a weapon (sights, scopes,
 * custom grips...). The effect text is captured raw; attaching to weapon
 * Items (embedded relation) comes with the weapon-upgrade flow later.
 */
export class WeaponModification extends Gear {
	static LOCALIZATION_PREFIXES = ["WEAPON_MODIFICATION"];

	declare upgrades: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			upgrades: textField(),
		};
	}
}
