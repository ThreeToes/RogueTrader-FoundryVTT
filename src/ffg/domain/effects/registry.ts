/**
 * The effect-kind registry and the ONE collector (epic kof0, phase 2).
 *
 * `collectEffects(view, query)` is the single walk over an actor's owned items
 * and their effect rows. Every consumer (the funnel, the damage pipeline, the
 * target-soak maths, roll mechanics, derived values, acquisition) goes through
 * it, so the liveness rules, key grammar and guard handling live in exactly one
 * place.
 */

import type { ActorView } from "../model/actor";
import { effectsAreLive } from "../model/effect";
import type { EffectHit, EffectQuery, EffectSpec } from "./types";

const byKind = new Map<string, EffectSpec>();

/** The effect-kind registry (extension seam: register a spec, done). */
export const effectKinds = {
	/** Register (or replace) a spec. */
	register(spec: EffectSpec): void {
		byKind.set(spec.kind, spec);
	},
	get(kind: string): EffectSpec | undefined {
		return byKind.get(kind);
	},
	kinds(): string[] {
		return [...byKind.keys()];
	},
	all(): EffectSpec[] {
		return [...byKind.values()];
	},
};

/** The authored kind, normalised to the schema default ("test-modifier"). */
function normalisedKind(effectKind: string | undefined): string {
	return effectKind && effectKind !== "" ? effectKind : "test-modifier";
}

/**
 * Collect every effect row that feeds `query.channel` and applies to the
 * context. The walk order is stable (item order, then effect order), so
 * breakdowns are deterministic.
 */
export function collectEffects(
	view: ActorView,
	query: EffectQuery,
): EffectHit[] {
	const hits: EffectHit[] = [];
	for (const item of view.items) {
		if (query.itemWhere && !query.itemWhere(item)) continue;
		for (const effect of item.effects) {
			const spec = byKind.get(normalisedKind(effect.kind));
			if (!spec || !spec.channels.includes(query.channel)) continue;
			const live = spec.live
				? spec.live(item)
				: effectsAreLive(item.type, item.equipState);
			if (!live) continue;
			if (spec.applies && !spec.applies(effect, query)) continue;
			hits.push({ item, effect, spec });
		}
	}
	return hits;
}

/** Map the modifier-producing hits of a query to `Modifier[]`. */
export function collectEffectModifiers(
	view: ActorView,
	query: EffectQuery,
): import("../../../rules-engine/src/modifier").Modifier[] {
	const out: import("../../../rules-engine/src/modifier").Modifier[] = [];
	for (const hit of collectEffects(view, query)) {
		const modifier = hit.spec.toModifier?.(hit.item, hit.effect, query);
		if (modifier) out.push(modifier);
	}
	return out;
}
