/**
 * Toxic weapon quality mechanics (bead d8bc, owner rule text 2026-10-02).
 *
 * The book rule (Core Rulebook printed pp117): a hit from a Toxic weapon
 * forces the victim to pass a Toughness Test or suffer the toxin's effects.
 * The owner's spec:
 *   (a) activation gate — ONLY when the target suffers at least 1 point of
 *       Damage from the initial strike AFTER Armour and Toughness Bonus
 *       reductions (zero damage = no poison);
 *   (b) the victim immediately makes a Toughness Test at −5 per point of
 *       Damage taken from that hit;
 *   (c) failure inflicts per-toxin secondary effects. The canonical basic
 *       toxin (Core Rulebook printed p117) deals an immediate 1d10 Impact
 *       Damage with no reduction; per-toxin extras stay GM-facing prose —
 *       the card notes them, nothing is auto-applied.
 *
 * This module is the pure kernel half: the gate, the penalty computation and
 * the funnel modifier. The Foundry-coupled orchestration (damage card button
 * -> shared Test machinery) lives in the adapter and the roll pipeline.
 */

import type { Modifier } from "../../rules-engine/index";

/** Book constant: −5 penalty per point of Damage taken from the toxic hit. */
export const TOXIC_PENALTY_PER_DAMAGE_POINT = 5;

/**
 * (a) The damage-dealt gate: the poison activates only if the weapon carries
 * the Toxic quality AND the hit dealt at least 1 point of Damage after Armour
 * and Toughness Bonus reductions. Zero damage = no poison.
 */
export function toxicActivates(
	toxicQualified: boolean,
	woundsAfterSoak: number,
): boolean {
	return toxicQualified && woundsAfterSoak >= 1;
}

/**
 * (b) The Toughness Test penalty: −5 per point of Damage taken from that
 * hit. Zero or negative damage clamps to no penalty (the caller should have
 * gated it out via toxicActivates anyway).
 */
export function toxicToughnessPenalty(woundsAfterSoak: number): number {
	if (!Number.isFinite(woundsAfterSoak)) {
		throw new RangeError("toxic: damage taken must be a finite number");
	}
	const clamped = Math.max(0, woundsAfterSoak);
	// -0 leaks out of the negation when clamped to zero; normalise it — a
	// zero penalty must read as 0 everywhere (breakdown, tests, cards).
	return clamped === 0 ? 0 : -TOXIC_PENALTY_PER_DAMAGE_POINT * clamped;
}

/**
 * (b) The penalty as a VISIBLE funnel modifier: it flows into the
 * TestDialog's contributor preview and the roll card's breakdown like every
 * other reaction modifier (the repo rule: modifiers are visible). The label
 * is localized by the caller (presentation layer).
 */
export function toxicToughnessModifier(
	woundsAfterSoak: number,
	label: string,
): Modifier {
	return {
		id: "toxic-toughness",
		source: { type: "effect", label: "toxic" },
		label,
		value: toxicToughnessPenalty(woundsAfterSoak),
	};
}