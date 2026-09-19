/**
 * Item/rules-dependent derived character values (pure, data-in/data-out).
 *
 * Definitional arithmetic lives on the Character model (characteristicBonus,
 * movement, initiativeBonus); everything that depends on owned items or
 * book rules with uncertain specifics lives here, VERIFY-flagged like the
 * kernel. Functions NEVER mutate documents - callers render or decide.
 */

import type { ActorView } from "../domain/model/actor";
import { collectEffects } from "../domain/effects";
import type { EffectData } from "../domain/model/effect";

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
	/**
	 * Effective characteristic bonus (owned-item modifiers applied), when the
	 * caller passes the live Character model (bead xu83). Raw data-in tests
	 * omit it and fall back to the stored value.
	 */
	characteristicBonus?: (key: string) => number;
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
export function woundsMax(view: ActorView): number {
	const base = Math.max(0, view.system.wounds?.max ?? 0);
	let levels = 0;
	for (const hit of collectEffects(view, { channel: "derived" })) {
		if (hit.spec.kind !== "wounds-max") continue;
		const value = hit.spec.read?.(hit.item, hit.effect, { channel: "derived" });
		if (typeof value === "number") levels += value;
	}
	return base + levels;
}

/** Fatigue threshold: the (effective) Toughness Bonus. */
export function fatigueThreshold(character: CharacterSystemLike): number {
	return (
		character.characteristicBonus?.("t") ??
		Math.floor((character.characteristics.t?.value ?? 0) / 10)
	);
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
