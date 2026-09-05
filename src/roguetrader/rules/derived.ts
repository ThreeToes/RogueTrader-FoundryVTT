/**
 * Item/rules-dependent derived character values (pure, data-in/data-out).
 *
 * Definitional arithmetic lives on the Character model (characteristicBonus,
 * movement, initiativeBonus); everything that depends on owned items or
 * book rules with uncertain specifics lives here, VERIFY-flagged like the
 * kernel. Functions NEVER mutate documents - callers render or decide.
 */

import { talentEffectHandlers } from "./talent-effects";
import { effectsAreLive, type EffectData } from "../data/item/effects";

/** Minimal shape of an owned item whose effects feed derived values. */
export interface OwnedItemLike {
	type?: string;
	name?: string;
	system?: { effects?: EffectData[]; equipState?: string };
}

export interface CharacterSystemLike {
	characteristics: Record<string, { value: number; unnatural: number }>;
}

/**
 * Derived wounds maximum. Remembered RT core: base (SB + TB) doubled, plus +1
 * wound per level of Sound Constitution (consumed via the wounds-max effect
 * handler, see rules/talent-effects.ts). Owned items contribute only when
 * live (equipped), so a stowed piece of gear with a wounds-max effect does
 * not inflate the maximum.
 */
export function woundsMax(
	character: CharacterSystemLike,
	items: OwnedItemLike[] = [],
): number {
	const tb = Math.floor((character.characteristics.t?.value ?? 0) / 10);
	const sb = Math.floor((character.characteristics.s?.value ?? 0) / 10);
	const levels = items.reduce((total, item) => {
		if (!effectsAreLive(item.type, item.system?.equipState)) return total;
		for (const effect of item.system?.effects ?? []) {
			if (effect.kind !== "wounds-max") continue;
			const results = talentEffectHandlers.run({}, item, effect);
			for (const result of results) {
				if (typeof result === "number") total += result;
			}
		}
		return total;
	}, 0);
	return (sb + tb) * 2 + levels;
}

/** Fatigue threshold: the Toughness Bonus. */
export function fatigueThreshold(character: CharacterSystemLike): number {
	return Math.floor((character.characteristics.t?.value ?? 0) / 10);
}

/**
 * Corruption/Insanity thresholds per the book: NOT modelled - the raw fields
 * stay manual until the rules are verified (returns null; no guessing).
 */
export function corruptionThreshold(_character: CharacterSystemLike): null {
	return null;
}
export function insanityThreshold(_character: CharacterSystemLike): null {
	return null;
}
