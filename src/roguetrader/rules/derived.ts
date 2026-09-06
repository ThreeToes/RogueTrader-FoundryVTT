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

export interface CharacterSystemLike {
	characteristics: Record<string, { value: number; unnatural: number }>;
	/** Stored maximum wounds (set at character creation per the Home World
	 *  formula; bead hbu). Undefined in raw test data = no base available. */
	wounds?: { max?: number };
}

/**
 * Derived wounds maximum (bead hbu): the BOOK defines starting wounds via
 * the Home World formula (double the Toughness Bonus + 1d5(+N), Core Rulebook
 * p17-24) — applied by the character creator and stored on the actor. The
 * runtime maximum is that stored base plus +1 wound per live wounds-max
 * effect (Sound Constitution levels, consumed via the wounds-max effect
 * handler, see rules/talent-effects.ts). The previous (SB+TB)*2 formula was
 * Dark-Heresy-style and contradicts every Home World section. Owned items
 * contribute only when live (equipped).
 */
export function woundsMax(
	character: CharacterSystemLike,
	items: OwnedItemLike[] = [],
): number {
	const base = Math.max(0, character.wounds?.max ?? 0);
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
	return base + levels;
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
