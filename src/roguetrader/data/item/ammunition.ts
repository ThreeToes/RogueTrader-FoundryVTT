import { Gear } from "./gear";

/**
 * Ammunition: consumable rounds for weapons (extends Gear's trade fields).
 *
 * Quantity (bead 1sxq) is inherited from the Gear base — Ammunition used to
 * declare its own `quantity` (integer, min 0, initial 0); folding it into the
 * base deliberately changes the un-authored initial from 0 to 1 (an item
 * exists at quantity 1, 0 = spent), per the owner decision on the shared Gear
 * quantity field (2026-10-02). min 0 / integer / required are unchanged.
 */
export class Ammunition extends Gear {
	static LOCALIZATION_PREFIXES = ["AMMUNITION"];
}
