/**
 * Item/rules-dependent derived character values (pure, data-in/data-out).
 *
 * Definitional arithmetic lives on the Character model (characteristicBonus,
 * movement, initiativeBonus); everything that depends on owned items or
 * book rules with uncertain specifics lives here, VERIFY-flagged like the
 * kernel. Functions NEVER mutate documents - callers render or decide.
 */

import { talentEffectHandlers } from "./talent-effects";

/** Minimal shape of a test-modifier talent effect (mirror of talent item data). */
export interface TalentEffectData {
	kind?: string;
	testKey?: string;
	value?: number;
	label?: string;
}

export interface OwnedTalentLike {
	name?: string;
	system?: { effects?: TalentEffectData[] };
}

export interface CharacterSystemLike {
	characteristics: Record<string, { value: number; unnatural: number }>;
}

/**
 * Derived wounds maximum. Remembered RT core: base (SB + TB) doubled, plus +1
 * wound per level of Sound Constitution (consumed via the wounds-max talent
 * effect handler, see rules/talent-effects.ts). (VERIFY against the core
 * book - left conservative until confirmed; null fields are not guessed.)
 */
export function woundsMax(
	character: CharacterSystemLike,
	talents: OwnedTalentLike[] = [],
): number {
	const tb = Math.floor((character.characteristics.t?.value ?? 0) / 10);
	const sb = Math.floor((character.characteristics.s?.value ?? 0) / 10);
	const levels = talents.reduce((total, talent) => {
		for (const effect of talent.system?.effects ?? []) {
			if (effect.kind !== "wounds-max") continue;
			const results = talentEffectHandlers.run({}, talent, effect);
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
