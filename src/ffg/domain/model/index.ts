/**
 * The domain read model (docs/ARCHITECTURE.md). Foundry-free by construction —
 * the boundary test enforces it.
 */

export {
	CHARACTER_ACTOR_TYPES,
	type ActorSystemView,
	type ActorView,
	type AnySystemView,
	type CharacterActorTypes,
	type CharacteristicView,
	type CharacterSystemView,
	type EffectView,
	type ItemView,
	STARSHIP_ACTOR_TYPES,
	type ShipActorTypes,
	type ShipSystemView,
	type SystemViewBase,
	type SystemViewOfActorType,
	VEHICLE_ACTOR_TYPES,
	type VehicleActorTypes,
	type VehicleSystemView,
	isCharacterView,
	itemById,
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
	WEAPON_ITEM_TYPES,
	type WeaponItemType,
} from "./taxonomy";
