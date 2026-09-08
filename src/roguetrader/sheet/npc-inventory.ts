/**
 * NPC inventory domain helpers (bead 2dvj) — pure functions, following the
 * skills-domain.ts pattern so the sheet stays thin and the rules stay tested.
 *
 * The NPC sheet is GM-facing fast-use: the inventory tab groups items by
 * type (no more all-types-in-one list), equippable items (weapons, gear)
 * get a stow/carry toggle, armour gets a wear/stow toggle in its own panel.
 * The main-tab combat rows keep the owner-spec no-equip anatomy (dropped
 * weapons arrive CARRIED — an NPC is holding what the GM gives it); this is
 * where the GM changes their mind about that.
 */
import { equipStateOf } from "../data/accessors";

/** Minimal owned-item shape the grouping/equip logic needs. */
export interface NpcInventoryItemLike {
	id?: string | null;
	name?: string;
	type?: string;
	system?: unknown;
	/** Raw item flags — read for the packer's compendiumSource stamp (et3x,
	 * surfaced as the sheet's link-back affordance, bead kwm9). */
	flags?: unknown;
}

/**
 * Next equip state for the NPC equip/stow toggle. ARMOUR-AWARE (bead 2dvj):
 * armour cycles worn<->stowed (the only valid armour states — the old
 * stowed<->carried toggle produced an invalid "carried" armour state);
 * weapons and gear cycle stowed<->carried. Anything else keeps its state
 * (non-equippable items never get a toggle anchor in the template).
 */
export function equipToggleState(
	type: string | undefined,
	current: string,
): string {
	if (type === "armour") {
		return current === "worn" ? "stowed" : "worn";
	}
	return current === "stowed" ? "carried" : "stowed";
}

/** A grouped inventory item as rendered on the NPC inventory tab. */
export interface NpcInventoryItem {
	id: string;
	name: string;
	type: string;
	/** Gets a stow/carry toggle anchor (weapons + gear only). */
	equippable: boolean;
	/** True when the item's equip state is its READY state. */
	ready: boolean;
	/** Compendium source uuid (et3x stamp) or "" when standalone/homebrew —
	 * empty renders NO link (no dead affordances). */
	source: string;
}

/** Read the packer's compendiumSource stamp off an owned item. */
export function compendiumSourceOf(item: NpcInventoryItemLike): string {
	const flags = item.flags as
		| { "rogue-trader"?: { compendiumSource?: string } }
		| undefined;
	return flags?.["rogue-trader"]?.compendiumSource ?? "";
}

export interface NpcInventoryGroup {
	labelKey: string;
	items: NpcInventoryItem[];
}

/** Group order (rendered top to bottom) and the types each group collects. */
const GROUP_ORDER: ReadonlyArray<{ types: readonly string[]; labelKey: string }> =
	[
		{ types: ["ranged-weapon"], labelKey: "TYPES.Item.ranged-weapon" },
		{ types: ["melee-weapon"], labelKey: "TYPES.Item.melee-weapon" },
		{ types: ["talent"], labelKey: "TYPES.Item.talent" },
		{ types: ["gear"], labelKey: "TYPES.Item.gear" },
	];

/** Types handled elsewhere on the tab (armour panel) or other tabs. */
const EXCLUDED_TYPES: ReadonlySet<string> = new Set([
	"skill",
	"psychicpower",
	"navigatorpower",
	"armour",
]);

/** Types that get an equip/stow toggle (matches the PC equip model). */
const EQUIPPABLE_TYPES: ReadonlySet<string> = new Set([
	"melee-weapon",
	"ranged-weapon",
	"gear",
]);

/**
 * Group NPC-owned items for the inventory tab: named groups in GROUP_ORDER,
 * a loud catch-all group for every other type (never silently dropped).
 * Empty groups are dropped.
 */
export function npcInventoryGroups(
	items: Iterable<NpcInventoryItemLike>,
): NpcInventoryGroup[] {
	const buckets = GROUP_ORDER.map(({ types, labelKey }) => ({
		labelKey,
		typeSet: new Set(types),
		items: [] as NpcInventoryItem[],
	}));
	const other: NpcInventoryGroup = { labelKey: "NPC.GROUP_OTHER", items: [] };
	for (const item of items) {
		const type = item.type ?? "";
		if (EXCLUDED_TYPES.has(type)) continue;
		const entry: NpcInventoryItem = {
			id: item.id ?? "",
			name: item.name ?? "",
			type,
			equippable: EQUIPPABLE_TYPES.has(type),
			ready: equipStateOf(item) === "carried",
			source: compendiumSourceOf(item),
		};
		const bucket = buckets.find((b) => b.typeSet.has(type));
		(bucket ?? other).items.push(entry);
	}
	return [...buckets.map(({ labelKey, items: bItems }) => ({ labelKey, items: bItems })), other].filter(
		(group) => group.items.length > 0,
	);
}