/**
 * Damage-dice analysis (bead k98i).
 *
 * The regression these pin: the Dice port flattens a roll into one bag of
 * dice, so reading that bag made a mixed formula's extra terms look like
 * damage dice. Tearing then discarded the d5 of a 1d10+1d5 weapon and added a
 * d10 roll, inflating damage, where the book says to discard the lowest of the
 * weapon's own damage dice.
 */

import { describe, expect, test } from "bun:test";
import {
	damageTerm,
	righteousFuryTriggered,
	tearingBase,
} from "./damage-dice";
import type { DiceResult, DiceTerm } from "./ports";

/** A roll result from explicit terms, with `dice` flattened as the port does. */
function roll(terms: DiceTerm[], total = 0): DiceResult {
	return {
		total,
		dice: terms.flatMap((term) =>
			term.results.map((result) => ({ result, faces: term.faces })),
		),
		terms,
		formula: terms.map((t) => `1d${t.faces}`).join("+"),
	};
}

const die = (faces: number, results: number[]): DiceTerm => ({
	class: "Die",
	faces,
	results,
});

describe("damageTerm", () => {
	test("finds the first die term", () => {
		expect(damageTerm(roll([die(10, [4, 7])]))?.faces).toBe(10);
	});

	test("skips a leading non-dice term (flat modifier)", () => {
		const withModifier: DiceResult = {
			...roll([die(10, [6])]),
			terms: [{ faces: 0, results: [] }, die(10, [6])],
		};
		expect(damageTerm(withModifier)?.results).toEqual([6]);
	});

	test("is undefined for a roll with no dice", () => {
		expect(damageTerm(roll([]))).toBeUndefined();
	});
});

describe("righteousFuryTriggered (RT core: natural 10 on a damage die)", () => {
	test("a 10 on a single damage die triggers", () => {
		expect(righteousFuryTriggered(roll([die(10, [10])]))).toBe(true);
	});

	test("a 10 on either die of a 2d10 triggers", () => {
		expect(righteousFuryTriggered(roll([die(10, [4, 10])]))).toBe(true);
	});

	test("no 10 does not trigger", () => {
		expect(righteousFuryTriggered(roll([die(10, [4, 7])]))).toBe(false);
	});

	test("a 10 on a non-d10 term does not trigger", () => {
		expect(righteousFuryTriggered(roll([die(5, [5]), die(10, [3])]))).toBe(
			false,
		);
	});

	test("a non-dice term is ignored", () => {
		const result: DiceResult = {
			...roll([die(10, [3])]),
			terms: [{ faces: 0, results: [10] }, die(10, [3])],
		};
		expect(righteousFuryTriggered(result)).toBe(false);
	});
});

describe("tearingBase (bead k98i regression)", () => {
	test("reports the damage die's faces and kept results", () => {
		expect(tearingBase(roll([die(10, [7, 2])]))).toEqual({
			faces: 10,
			results: [7, 2],
		});
	});

	test("a mixed formula contributes ONLY its damage die", () => {
		// 1d10+1d5: the d5 is not a damage die, so Tearing must not see it.
		const mixed = roll([die(10, [4]), die(5, [1])]);
		expect(tearingBase(mixed)).toEqual({ faces: 10, results: [4] });
	});

	test("falls back to d10 with no results when the roll had no dice", () => {
		expect(tearingBase(roll([]))).toEqual({ faces: 10, results: [] });
	});

	test("the mixed-formula d5 can no longer be the discarded die", () => {
		// The old behaviour fed [4, 1] to applyTearing, so the d5's 1 was the
		// lowest and got replaced by a d10 roll (damage inflated). Now only the
		// damage die competes, so the discarded die is the d10's own 4.
		const { results, faces } = tearingBase(roll([die(10, [4]), die(5, [1])]));
		const lowest = Math.min(...results);
		expect(lowest).toBe(4);
		expect(faces).toBe(10);
		expect(results).not.toContain(1);
	});
});
