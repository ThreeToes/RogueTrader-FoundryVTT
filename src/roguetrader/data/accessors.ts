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
} from "../domain/model/taxonomy";

/**
 * The unified pc/npc character system model. Every CharacterData-carrying
 * actor type (pc, explorer, npc — all mapped to Character in sheet/init)
 * passes through here; fvtt-types cannot express that, so the single
 * assertion lives in this module.
 */
export function systemOf(actor: { system: unknown }): Character {
	return actor.system as Character;
}
