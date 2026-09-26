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
 * The full RT view: union of every actor family's system fields. This is the
 * default instantiation of `ActorView`/`buildActorView` so existing RT call
 * sites do not churn; sibling systems (DH2, Only War…) instantiate with just
 * the `SystemViewBase`-extending type they support.
 */
export type ActorSystemView = CharacterSystemView &
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
