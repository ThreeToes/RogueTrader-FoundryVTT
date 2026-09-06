/**
 * Typed system/item accessors (bead p5nw): centralize the shape assumptions
 * that were previously scattered as `as unknown as X` casts across sheets,
 * the rules adapter and the funnel.
 *
 * Why an assertion is needed at all: fvtt-types model `actor.type` as
 * `"base" | ModuleSubType` and cannot know the subtypes this system
 * registers, so `actor.system` is only ever `unknown` to the type checker.
 * The assumption "pc/explorer/npc actors carry the unified Character model"
 * lives HERE, once — new item/actor types extend these accessors instead of
 * re-teaching every call site.
 */

import type { Character } from "./actor/character";

// ---------------------------------------------------------------------------
// Weapon item types
// ---------------------------------------------------------------------------

/** The weapon item types (the only types that can roll attacks). */
export const WEAPON_ITEM_TYPES = ["melee-weapon", "ranged-weapon"] as const;

export type WeaponItemType = (typeof WEAPON_ITEM_TYPES)[number];

/**
 * Whether a document/item type is a weapon. Replaces the
 * `type === "melee-weapon" || type === "ranged-weapon"` disjunctions
 * (x11 across 8 files at survey time).
 */
export function isWeaponType(
	type: string | undefined | null,
): type is WeaponItemType {
	return type === "melee-weapon" || type === "ranged-weapon";
}

// ---------------------------------------------------------------------------
// Equip state (item-side equip model, gear.ts schema)
// ---------------------------------------------------------------------------

/** Structural shape needed to read an owned item's equip state. */
export interface EquipableLike {
	type?: string;
	system?: unknown;
}

/**
 * The item's equip state, defaulting to "stowed" (the schema initial in
 * gear.ts). Weapons/gear are stowed|carried; armour is worn.
 */
export function equipStateOf(item: EquipableLike): string {
	return (
		(item.system as { equipState?: string } | undefined)?.equipState ??
		"stowed"
	);
}

/**
 * Ready-state semantics (previously only in comments): weapons and gear are
 * ready when CARRIED; armour is ready (contributing) when WORN. Matches the
 * carried-weight filter in rules/encumbrance.ts and the attack equip gate in
 * rules/adapter.ts.
 */
export function isReady(item: EquipableLike): boolean {
	const state = equipStateOf(item);
	return item.type === "armour" ? state === "worn" : state === "carried";
}

// ---------------------------------------------------------------------------
// Actor system access
// ---------------------------------------------------------------------------

/**
 * The unified pc/npc character system model. Every CharacterData-carrying
 * actor type (pc, explorer, npc — all mapped to Character in sheet/init)
 * passes through here; fvtt-types cannot express that, so the single
 * assertion lives in this module.
 */
export function systemOf(actor: { system: unknown }): Character {
	return actor.system as Character;
}