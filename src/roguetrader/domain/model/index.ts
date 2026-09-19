/**
 * The domain read model (docs/ARCHITECTURE.md). Foundry-free by construction —
 * the boundary test enforces it.
 */

export {
	type ActorSystemView,
	type ActorView,
	type CharacteristicView,
	type EffectView,
	itemById,
	type ItemView,
	itemsOfType,
} from "./actor";
export {
	type AttackProfile,
	type AttackSource,
	attackProfileOf,
	type DamageSource,
	profileDamageType,
} from "./attack";
export {
	buildActorView,
	type LooseActor,
	type LooseEffect,
	type LooseItem,
} from "./build";
export { DamageType, normaliseDamageType } from "./damage";
export {
	blankEffect,
	corruptionExpressions,
	type EffectData,
	effectsAreLive,
	withAddedEffect,
	withoutEffectAt,
} from "./effect";
export {
	type EquipableLike,
	type EquipState,
	equipStateOf,
	isReady,
	isWeaponType,
	type WeaponItemType,
	WEAPON_ITEM_TYPES,
} from "./taxonomy";
