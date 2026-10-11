/**
 * PC inventory grouping (bead packs-pu9): the inventory tab's groups as a PURE
 * mapping, so the CharacterSheet stays thin and the grouping is unit-tested —
 * the npc-inventory.ts contract: named groups plus a loud catch-all, so a
 * dropped item of ANY type is rendered, never silently invisible.
 *
 * THE BUG THIS FIXES: the inventory context carried four typed groups
 * (weapons/armour/gear/ammunition) and NOTHING else, so a GM dropping a
 * `special-ability` item — the two Table 1-2 heirloom special-abilities
 * (Ancestral Seal, Reliquary of Saint Drusus, Core Rulebook p31) — cloned it
 * onto the actor and then saw it nowhere: the drop "succeeded", the item
 * simply rendered in no group. Heirloom weapons/armour landed fine, which is
 * why the report said "still can't ADD heirlooms": the abilities were
 * un-addable by drag from the GM's point of view (nothing appeared).
 */

/** The row shape the CharacterSheet builds (weight/equip labels resolved). */
export interface PcInventoryItemLike {
	id: string | null;
	name: string | null;
	uuid: string;
	type: string;
	weight: number;
	quantity: number;
	equipState: string;
	equipStateLabel: string;
	equipped: boolean;
	isWeapon: boolean;
}

/** A grouped row: adds the template's toggle/weight-slot decisions. */
export interface PcInventoryRow extends PcInventoryItemLike {
	/** Only equippable types render the stow/carry circle-check anchor. */
	equippable: boolean;
	/** Rendered weight slot ("2.5 kg", "×3"); empty suppresses the slot. */
	weightLabel: string;
	/** Only set on the ammunition group's rows (bead 8uc7 template branch). */
	isAmmunition?: boolean;
}

/** A titled inventory group; empty groups are dropped. */
export interface PcInventoryGroup {
	labelKey: string;
	items: PcInventoryRow[];
}

/** Types that get an equip/stow toggle (matches the PC equip model). */
export const PC_EQUIPPABLE_TYPES: ReadonlySet<string> = new Set([
	"melee-weapon",
	"ranged-weapon",
	"armour",
	"gear",
]);

/**
 * Types handled on other tabs/panels, so they must NOT reach the inventory nor
 * the catch-all (skills tab, background tab's talents, the psychic tab, the
 * actions tab).
 */
export const INVENTORY_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
	"skill",
	"talent",
	"psychicpower",
	"navigatorpower",
	"action",
]);

/** The typed groups: label key, collected types, template branch flags. */
const GROUP_DEFS: ReadonlyArray<{
	labelKey: string;
	types: readonly string[];
	isAmmunition?: boolean;
}> = [
	{ labelKey: "WEAPON.HEADER", types: ["melee-weapon", "ranged-weapon"] },
	{ labelKey: "ARMOUR.HEADER", types: ["armour"] },
	{ labelKey: "GEAR.HEADER", types: ["gear"] },
	// Ammunition group (bead 8uc7): ordnance is not equippable — the template's
	// isAmmunition branch renders it with the xN quantity and no toggle.
	{
		labelKey: "AMMUNITION.HEADER",
		types: ["ammunition"],
		isAmmunition: true,
	},
	// The special-abilities group (bead packs-pu9): the Table 1-2 heirloom
	// abilities' home, so a dropped heirloom lands visibly, not in the
	// type-blind catch-all.
	{ labelKey: "INVENTORY.ABILITIES", types: ["special-ability"] },
];

/**
 * Group inventory rows for the tab: named groups in GROUP_DEFS order, then the
 * loud catch-all group for every remaining type. Empty groups are dropped.
 */
export function pcInventoryGroups(
	items: Iterable<PcInventoryItemLike>,
): PcInventoryGroup[] {
	const buckets = GROUP_DEFS.map(({ labelKey, types, isAmmunition }) => ({
		labelKey,
		typeSet: new Set(types),
		isAmmunition: Boolean(isAmmunition),
		items: [] as PcInventoryRow[],
	}));
	const other: PcInventoryRow[] = [];
	for (const item of items) {
		const type = item.type ?? "";
		const row: PcInventoryRow = {
			...item,
			equippable: PC_EQUIPPABLE_TYPES.has(type),
			// The weight slot: items carry kg; the ammunition group renders its
			// Gear-base quantity as the ×N usage count instead (bead 8uc7).
			weightLabel: item.weight > 0 ? `${item.weight} kg` : "",
			...(item.type === "ammunition" && item.quantity > 0
				? { weightLabel: `×${item.quantity}` }
				: {}),
		};
		const bucket = buckets.find((b) => b.typeSet.has(type));
		if (bucket) {
			if (bucket.isAmmunition) row.isAmmunition = true;
			bucket.items.push(row);
		} else {
			other.push(row);
		}
	}
	return [...buckets.map(b => ({labelKey: b.labelKey, items: b.items})), {labelKey: "INVENTORY.OTHER", items: other}].filter((group) => group.items.length > 0);
}