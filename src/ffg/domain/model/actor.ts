/**
 * The actor read model — the single typed boundary between Foundry documents
 * and the rules layer (docs/ARCHITECTURE.md).
 *
 * Rules never take a Foundry `Actor`. They take an `ActorView`: a plain,
 * Foundry-free snapshot built once per roll by
 * `infrastructure/foundry/actor-view.ts`. That is why the rules layer has no
 * `as unknown as` casts and why tests can build real fixtures.
 */

import type { AttackProfile } from "./attack";
import type { EffectData } from "./effect";
import type { EquipState } from "./taxonomy";

export interface CharacteristicView {
	value: number;
	unnatural: number;
}

/** One item, normalised. `system` is the raw data for type-specific reads. */
export interface ItemView {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly equipState: EquipState;
	readonly effects: readonly EffectData[];
	/** Weapon specials / qualities, when the item is a weapon. */
	readonly special: readonly string[];
	/** Resolved attack profile (weapon or mutation attack), else null. */
	readonly attack: AttackProfile | null;
	/** Raw system data (the escape hatch for type-specific fields). */
	readonly system: Readonly<Record<string, unknown>>;
}

/** One applied ActiveEffect, normalised (the funnel's "effect" contributor). */
export interface EffectView {
	readonly id: string;
	readonly name: string;
	readonly statuses: readonly string[];
	readonly changes: ReadonlyArray<{ key: string; value: unknown }>;
	/** Book "snap out of it" flag carried on the effect. */
	readonly snapOut: boolean;
}

/**
 * The subset of actor system data the rules layer reads. Deliberately
 * enumerated (not an index signature) so a typo is a compile error and the
 * contract grows on purpose. The builder is the one place that maps the real
 * document onto this shape.
 */
/**
 * System-agnostic part of the actor system data every system reads.
 * Deliberately enumerated (not an index signature) so a typo is a compile
 * error and the contract grows on purpose. The builder is the one place that
 * maps the real document onto this shape.
 */
export interface SystemViewBase {
	characteristics: Readonly<Record<string, CharacteristicView>>;
	/** Effective characteristic bonus (owned-item modifiers applied). */
	characteristicBonus?: (key: string) => number;
}

/** RT/DH2-style character system data. */
export interface CharacterSystemView extends SystemViewBase {
	origins?: Record<string, unknown>;
	wounds?: { value?: number; max?: number };
	psyker?: boolean;
	psyRating?: number;
	sorceryRank?: number | string;
	sanctioned?: boolean;
	corruption?: number;
	insanity?: number;
	sustainedPowers?: ReadonlyArray<{ itemUuid: string; name: string }>;
	criticals?: Record<string, number>;
	criticalEffects?: readonly unknown[];
	criticalOverrideRound?: number;
}

/** The actor types the registry maps onto the unified Character model. */
export const CHARACTER_ACTOR_TYPES = ["pc", "explorer", "npc"] as const;
export type CharacterActorTypes = (typeof CHARACTER_ACTOR_TYPES)[number];

/** The actor types carrying a starship system model. */
export const STARSHIP_ACTOR_TYPES = ["starship"] as const;
export type ShipActorTypes = (typeof STARSHIP_ACTOR_TYPES)[number];

/** The actor types carrying a vehicle system model. */
export const VEHICLE_ACTOR_TYPES = ["vehicle"] as const;
export type VehicleActorTypes = (typeof VEHICLE_ACTOR_TYPES)[number];

/**
 * Actor type -> system-view family. Distributed, so a union of actor types
 * yields the union of their families. Types carrying none of the RT family
 * models (dynasty, planet, cache) fall through to just the base view: they
 * claim none of the family fields, which is the point of the families.
 */
export type SystemViewOfActorType<T extends string> =
	T extends CharacterActorTypes
		? CharacterSystemView
		: T extends ShipActorTypes
			? ShipSystemView
			: T extends VehicleActorTypes
				? VehicleSystemView
				: SystemViewBase;

/** RT ship system data. */
export interface ShipSystemView extends SystemViewBase {
	crewQuality?: string;
	armour?: number;
	voidShields?: number;
	hullIntegrity?: { value?: number; max?: number };
	crewPopulation?: number;
	crewMorale?: number;
}

/** RT vehicle system data. */
export interface VehicleSystemView extends SystemViewBase {
	size?: string;
}

/**
 * The union of every RT actor family's system view (bead l2wz). This is the
 * DEFAULT instantiation of `ActorView`/`buildActorView`: a bare `ActorView`
 * must be able to name any of the RT families, so reads of family-specific
 * fields still require narrowing (a character view does NOT carry
 * `voidShields` — that was the wide-cross-product bug).
 */
export type ActorSystemView =
	| CharacterSystemView
	| ShipSystemView
	| VehicleSystemView;

/**
 * The WIDE cross-product of every actor family (all families' fields at
 * once) — explicitly labelled for what it is. A view typed with this claims
 * fields that only some actors have, so it is only honest for plumbing that
 * genuinely must accept every family's full field set (none currently does);
 * prefer a single family view or the `ActorSystemView` union. Exported for
 * explicit `ActorView<AnySystemView>` instantiations, never as a default.
 */
export type AnySystemView = CharacterSystemView &
	ShipSystemView &
	VehicleSystemView;

/** A plain, Foundry-free snapshot of an actor for one rules operation. */
export interface ActorView<S extends SystemViewBase = ActorSystemView> {
	readonly id: string;
	readonly uuid: string;
	readonly name: string;
	readonly type: string;
	readonly system: S;
	readonly characteristics: Readonly<Record<string, CharacteristicView>>;
	readonly items: readonly ItemView[];
	/** ActiveEffects OWNED by the actor (conditions, snap-out). */
	readonly effects: readonly EffectView[];
	/** Effects currently APPLIED to the actor (includes transferred item effects). */
	readonly appliedEffects: readonly EffectView[];
}

/**
 * Narrow a view to the character family (pc/explorer/npc). The builder picks
 * the family per `actor.type`; this is the runtime mirror of that choice, so
 * rules code with character-only fields (wounds, psyker flags, origins) can
 * narrow honestly instead of reading possibly-absent fields off a wide view.
 */
export function isCharacterView(
	view: ActorView,
): view is ActorView<CharacterSystemView> {
	return (CHARACTER_ACTOR_TYPES as readonly string[]).includes(view.type);
}

/** Find an owned item by id. */
export function itemById(
	view: ActorView,
	id: string | null | undefined,
): ItemView | undefined {
	if (!id) return undefined;
	return view.items.find((item) => item.id === id);
}

/** Every owned item whose type is one of `types`. */
export function itemsOfType(
	view: ActorView,
	...types: string[]
): readonly ItemView[] {
	const wanted = new Set(types);
	return view.items.filter((item) => wanted.has(item.type));
}
