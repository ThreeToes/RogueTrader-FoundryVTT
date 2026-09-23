import { Gear } from "./gear";
import { textField } from "../fields";

/**
 * Armour modification: an upgrade fitted to a suit of armour (Hostile
 * Acquisitions Table 2-17, printed p64 — Advanced Materials, Lathe-wrought,
 * Reflec Coating...). Mirrors WeaponModification: the effect text is
 * captured raw in `upgrades` (the book's "Upgrades:" line); attaching to
 * armour Items comes with the armour-upgrade flow later.
 */
export class ArmourModification extends Gear {
	static LOCALIZATION_PREFIXES = ["ARMOUR_MODIFICATION"];

	declare upgrades: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			upgrades: textField(),
		};
	}
}
