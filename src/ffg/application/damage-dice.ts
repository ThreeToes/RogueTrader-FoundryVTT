/**
 * Damage-dice analysis (epic kof0, bead k98i).
 *
 * Pure helpers over a Dice port result. They exist because the adapter used to
 * read the port's FLAT dice list, which merges every term of the formula into
 * one bag: for 1d10+1d5 the d5 became a "damage die", so Tearing could discard
 * it and add a d10 roll — inflating damage — where the book's rule is to
 * discard the lowest of the weapon's own damage dice.
 *
 * These are Foundry-free (the boundary test enforces it), so the damage-die
 * semantics can be tested without a Foundry global.
 */

import type { DiceResult, DiceTerm } from "./ports";

/** Is this term one of the roll's actual dice? */
function isDie(term: DiceTerm): boolean {
	if ((term.faces ?? 0) <= 0) return false;
	// Foundry reports the term class; hand-built fakes may omit it.
	return term.class === undefined || term.class === "Die";
}

/** The first die term of a roll — the weapon's damage die. */
export function damageTerm(result: DiceResult): DiceTerm | undefined {
	return result.terms.find(isDie);
}

/**
 * Righteous Fury trigger (RT core, VERIFY wording): a natural 10 on a damage
 * die. Any die term qualifies (a 2d10 weapon can trigger on either die), but
 * non-dice terms never do.
 */
export function righteousFuryTriggered(result: DiceResult): boolean {
	return result.terms.some((term) => isDie(term) && term.faces === 10 && term.results.includes(10));
}

/**
 * The Tearing base (bead gci0): the damage die's kept results and how many
 * sides it had, so the extra die matches the weapon's own die type.
 */
export function tearingBase(result: DiceResult): {
	faces: number;
	results: number[];
} {
	const term = damageTerm(result);
	return { faces: term?.faces ?? 10, results: term?.results ?? [] };
}
