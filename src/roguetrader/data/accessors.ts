/**
 * Typed system/item accessors (bead p5nw): the single place the system's
 * document-shape assumptions live.
 *
 * Why an assertion is needed at all: fvtt-types model `actor.type` as
 * `"base" | ModuleSubType` and cannot know the subtypes this system registers,
 * so `actor.system` is only ever `unknown` to the type checker. The assumption
 * "pc/explorer/npc actors carry the unified Character model" lives HERE, once.
 *
 * The pure item taxonomy moved to the domain model in phase 1
 * (`domain/model/taxonomy.ts`) and is re-exported here for compatibility.
 */

import type { Character } from "./actor/character";

export {
	type EquipableLike,
	type EquipState,
	equipStateOf,
	isReady,
	isWeaponType,
	type WeaponItemType,
	WEAPON_ITEM_TYPES,
} from "../../ffg/domain/model/taxonomy";

/**
 * The unified pc/npc character system model. Every CharacterData-carrying
 * actor type (pc, explorer, npc — all mapped to Character in bootstrap/sheets.ts)
 * passes through here; fvtt-types cannot express that, so the single
 * assertion lives in this module.
 */
export function systemOf(actor: { system: unknown }): Character {
	return actor.system as Character;
}

/**
 * Actor-side launcher-ordnance resolver (bead 4obp, design D4i): wraps an
 * actor's items collection as the `ammoResolver` attackProfileOf consumes —
 * an owned item id → owned item document, null when the id resolves to
 * nothing (deleted/foreign item). Foundry documents pass structurally; the
 * domain layer stays Foundry-free.
 */
export function ownedItemResolver(
	actor: unknown,
): (id: string) => object | null {
	const items = (actor as { items?: Map<string, object> } | null)?.items;
	return (id) => items?.get(id) ?? null;
}
