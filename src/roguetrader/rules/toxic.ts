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

import {
	DEFAULT_SYSTEM_PROFILE,
	type SystemProfile,
} from "../../ffg/domain/system-profile";
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
 * gated it out via toxicActivates anyway). The penalty per point is profile
 * DATA (bead wxut.2 reads the effective profile) with the book constant
 * TOXIC_PENALTY_PER_DAMAGE_POINT as the core value and registry source.
 */
export function toxicToughnessPenalty(
	woundsAfterSoak: number,
	profile: SystemProfile = DEFAULT_SYSTEM_PROFILE,
): number {
	if (!Number.isFinite(woundsAfterSoak)) {
		throw new RangeError("toxic: damage taken must be a finite number");
	}
	const clamped = Math.max(0, woundsAfterSoak);
	// An empty/absent house-rule penalty is not configured — fall back to the
	// book value rather than computing NaN.
	const perPoint = Number.isFinite(profile.penaltyPerDamagePoint)
		? profile.penaltyPerDamagePoint
		: TOXIC_PENALTY_PER_DAMAGE_POINT;
	// -0 leaks out of the negation when clamped to zero; normalise it — a
	// zero penalty must read as 0 everywhere (breakdown, tests, cards).
	return clamped === 0 ? 0 : -perPoint * clamped;
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
	profile: SystemProfile = DEFAULT_SYSTEM_PROFILE,
): Modifier {
	return {
		id: "toxic-toughness",
		/**
		 * The label is an i18n KEY (bead vese): the display seams (TestDialog's
		 * `{{localize m.sourceLabel}}`) resolve it; free text here would render
		 * untranslated with a missing-key warning.
		 */
		source: { type: "effect", label: "SOURCE.FROM_TOXIC" },
		label,
		value: toxicToughnessPenalty(woundsAfterSoak, profile),
	};
}
