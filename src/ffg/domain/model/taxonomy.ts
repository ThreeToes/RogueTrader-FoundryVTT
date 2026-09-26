/**
 * Item taxonomy: the pure predicates the rules layer shares.
 *
 * Moved from `data/accessors.ts` (which keeps a re-export shim). These are
 * domain facts about items — what a weapon is, what "ready" means — not
 * Foundry schema concerns, so they belong in the domain model.
 */

/** The weapon item types (the only types that can roll attacks). */
export const WEAPON_ITEM_TYPES = ["melee-weapon", "ranged-weapon"] as const;

export type WeaponItemType = (typeof WEAPON_ITEM_TYPES)[number];

/** The item-side equip model (gear.ts schema). */
export type EquipState = "stowed" | "carried" | "worn";

/** Structural shape needed to read an item's equip state. */
export interface EquipableLike {
	type?: string;
	system?: unknown;
}

/**
 * Whether a document/item type is a weapon. Replaces the
 * `type === "melee-weapon" || type === "ranged-weapon"` disjunctions.
 */
export function isWeaponType(
	type: string | undefined | null,
): type is WeaponItemType {
	return type === "melee-weapon" || type === "ranged-weapon";
}

/** The item's equip state, defaulting to "stowed" (the schema initial). */
export function equipStateOf(item: EquipableLike): EquipState {
	const state = (item.system as { equipState?: string } | undefined)?.equipState;
	return state === "carried" || state === "worn" ? state : "stowed";
}

/**
 * The FFG 40k characteristic vocabulary, in book order. Pure data so the
 * rules layer can read it without importing the Foundry-coupled Character
 * DataModel; data/actor/character.ts re-exports it for compatibility.
 */
export const CHARACTERISTIC_KEYS = [
	"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
] as const;

export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

/**
 * Ready-state semantics: weapons and gear are ready when CARRIED; armour is
 * ready (contributing) when WORN. Matches the carried-weight filter in
 * rules/encumbrance.ts and the attack equip gate.
 */
export function isReady(item: EquipableLike): boolean {
	const state = equipStateOf(item);
	return item.type === "armour" ? state === "worn" : state === "carried";
}
