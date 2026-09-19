/**
 * The effect engine's types (epic kof0, phase 2).
 *
 * An "effect" is one row on an owned item (`EffectData`). The engine turns the
 * many ad-hoc `collect*` walks into ONE registry of specs plus one collector,
 * so adding a kind is a single registration.
 *
 * A spec declares:
 *  - which CHANNEL it feeds (test modifiers, damage, target soak, …);
 *  - its KEY grammar / applicability (`applies`);
 *  - how it becomes a `Modifier` (`toModifier`) or a typed payload (`read`);
 *  - optionally, its own liveness gate (`live`; defaults to `effectsAreLive`).
 */

import type { ItemView } from "../model/actor";
import type { TestKind } from "../model/test";
import type { Modifier } from "../../../rules-engine/src/modifier";
import type { EffectData } from "../model/effect";

/** What a kind feeds. One kind may feed several channels. */
export type EffectChannel =
	| "test" // test modifiers (the funnel)
	| "damage" // flat / critical damage (the damage pipeline)
	| "target-soak" // target-side TB multiplier / flat reduction
	| "roll-mechanic" // tearing / toxic / blast
	| "derived" // wounds-max, skill-rank, sorcery-rank
	| "acquisition"; // grants, procedures, corruption

/** Everything a spec needs to decide applicability and build its result. */
export interface EffectContext {
	readonly channel: EffectChannel;
	/** Test channel: the kind of test being rolled. */
	readonly testKind?: TestKind;
	/** Test channel: the characteristic key (or test id). */
	readonly testKey?: string;
	/** Test channel: the skill item's lowercased name (bead r1k). */
	readonly skillName?: string;
	/** Damage channel: melee vs ranged matching. */
	readonly attackType?: "melee-weapon" | "ranged-weapon";
	/** Damage/roll-mechanic channel: the attacking weapon's id. */
	readonly weaponId?: string;
	/** Guarded-effect flags (talentConditions keys). */
	readonly flags?: Record<string, boolean>;
	/** Collect guarded rows regardless of their flag (condition toggles). */
	readonly ignoreGuards?: boolean;
}

/** One registered effect kind. */
export interface EffectSpec {
	/** The `kind` string authored on the effect row. */
	readonly kind: string;
	/** Channels this kind feeds. */
	readonly channels: readonly EffectChannel[];
	/** Liveness gate for the carrying item (default: effectsAreLive). */
	readonly live?: (item: ItemView) => boolean;
	/** Applicability: key grammar + guard + any value sanity check. */
	readonly applies?: (effect: EffectData, ctx: EffectContext) => boolean;
	/** Test/damage channels: how the row becomes a Modifier. */
	readonly toModifier?: (
		item: ItemView,
		effect: EffectData,
		ctx: EffectContext,
	) => Modifier | null;
	/** Payload channels: the typed value the consumer reads. */
	readonly read?: (
		item: ItemView,
		effect: EffectData,
		ctx: EffectContext,
	) => unknown;
}

/** One matching effect row, with its owning item and spec. */
export interface EffectHit {
	readonly item: ItemView;
	readonly effect: EffectData;
	readonly spec: EffectSpec;
}

/** A collector query: the context plus an optional item filter. */
export interface EffectQuery extends EffectContext {
	/** Extra item filter (e.g. only the attacking weapon). */
	readonly itemWhere?: (item: ItemView) => boolean;
}
