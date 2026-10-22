/**
 * The ONE characteristic-delta collector (bead jahb).
 *
 * `Character.effectiveCharacteristicValue` used to hand-walk owned items with
 * its own rules and never read the effect's guard, so a condition-guarded row
 * (e.g. `{kind: "characteristic-modifier", testKey: "ag", value: -15,
 * condition: "frenzying"}`) was dropped from Agility TESTS (the funnel's
 * guardPasses) while EVERY reader of the effective value — skill display,
 * movement, initiative, soak, carrying capacity — saw the reduced value. This
 * helper routes the walk through `collectEffects`, so the guard policy
 * (`guardPasses`), the liveness table (`effectsAreLive`) and the key grammar
 * (`keyMatches`, characteristic mode) are the effect-kind spec's; the
 * architecture test pins that no module outside `domain/effects` re-walks the
 * kind (bead jahb).
 *
 * Guard policy note: a guarded row contributes ONLY when its flag is set —
 * callers without a flag context (sheet display and derived badges, which
 * pass no flags) see the unguarded value, matching what tests would roll.
 * Wildcard rows (`testKey` empty) never match a characteristic (mode
 * "characteristic") and rows of OTHER kinds (e.g. "skill-rank") are excluded
 * even when their rows sit on the same item.
 *
 * Pure: plain shapes in, a number out. Accepts EITHER consumer shape — the
 * funnel's flat `ItemView` fields (`equipState`/`effects` at the top) or a
 * raw document with them under `system` (the Character model's `parent.items`)
 * — the same convention as the initiative-row collector (bead zl6e), so no
 * call site maps shapes.
 */

import type { ActorView } from "../model/actor";
import { collectEffects } from "./registry";

/** One owned item in EITHER consumer shape. */
export interface CharacteristicItemIn {
	id?: string;
	name?: string;
	type?: string;
	equipState?: unknown;
	effects?: unknown;
	system?: { equipState?: unknown; effects?: unknown };
}

/**
 * The delta every live "characteristic-modifier" row keyed `key` contributes,
 * minus guarded rows whose condition flag is not set. Stable order (item
 * order, then effect order) keeps the fold deterministic; the result is a
 * plain signed sum.
 */
export function collectCharacteristicDelta(
	items: Iterable<CharacteristicItemIn> | null | undefined,
	key: string,
	flags?: Record<string, boolean>,
): number {
	if (!items) return 0;
	// Normalise each item onto the flat shape collectEffects reads (type,
	// equipState, effects at the top), exactly as the call sites carry them.
	const view = {
		items: [...items].map((item) => ({
			...item,
			equipState: item.equipState ?? item.system?.equipState,
			effects: item.effects ?? item.system?.effects ?? [],
		})),
	} as unknown as ActorView;
	let delta = 0;
	for (const hit of collectEffects(view, {
		channel: "test",
		testKey: key,
		...(flags ? { flags } : {}),
	})) {
		// The spec's `applies` already ran the guard, the liveness gate and the
		// characteristic key match; the kind filter keeps sibling kinds keyed
		// the same characteristic ("test-modifier" rows apply to TESTS, not to
		// the derived value) out of the fold.
		if (hit.spec.kind !== "characteristic-modifier") continue;
		delta += Number(hit.effect.value);
	}
	return delta;
}
