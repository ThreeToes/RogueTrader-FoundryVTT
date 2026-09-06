import {
	effectivePsyRating,
	focusPowerAutoFailFloor,
	phenomenaRollModifier,
	phenomenaTableName,
	pushCap,
	shouldRollPhenomena,
	psyRatingBonus,
	STRENGTH_LEVELS,
} from "./psychic";

describe("psyker mechanics (bead sa6, Core Rulebook Table 6-1 book p157)", () => {
	test("strength levels are fettered/unfettered/push", () => {
		expect(STRENGTH_LEVELS).toEqual(["fettered", "unfettered", "push"]);
	});

	test("fettered is half Psy Rating rounded up", () => {
		expect(effectivePsyRating({ psyRating: 5, strength: "fettered" })).toBe(3);
		expect(effectivePsyRating({ psyRating: 4, strength: "fettered" })).toBe(2);
		expect(effectivePsyRating({ psyRating: 1, strength: "fettered" })).toBe(1);
		expect(effectivePsyRating({ psyRating: 0, strength: "fettered" })).toBe(0);
	});

	test("unfettered is the full Psy Rating", () => {
		expect(effectivePsyRating({ psyRating: 5, strength: "unfettered" })).toBe(5);
	});

	test("push adds the chosen levels", () => {
		expect(
			effectivePsyRating({ psyRating: 3, strength: "push", pushLevels: 2 }),
		).toBe(5);
		expect(
			effectivePsyRating({ psyRating: 3, strength: "push", pushLevels: 4 }),
		).toBe(7);
		// Default push level is 1 when unspecified.
		expect(effectivePsyRating({ psyRating: 3, strength: "push" })).toBe(4);
	});

	test("sustained powers lower effective Psy Rating by 1 each", () => {
		expect(
			effectivePsyRating({
				psyRating: 5,
				strength: "unfettered",
				sustainedCount: 2,
			}),
		).toBe(3);
		// Two sustained powers while pushing compounds with the push bonus.
		expect(
			effectivePsyRating({
				psyRating: 4,
				strength: "push",
				pushLevels: 2,
				sustainedCount: 3,
			}),
		).toBe(3);
		// Never below zero.
		expect(
			effectivePsyRating({ psyRating: 1, strength: "fettered", sustainedCount: 5 }),
		).toBe(0);
	});

	test("characteristic bonus is +5 per effective rating", () => {
		expect(psyRatingBonus(0)).toBe(0);
		expect(psyRatingBonus(3)).toBe(15);
	});

	test("push cap is +3 sanctioned, +4 renegade", () => {
		expect(pushCap(true)).toBe(3);
		expect(pushCap(false)).toBe(4);
	});

	test("phenomena roll modifier: +5 per push level, +10 per sustained power", () => {
		expect(phenomenaRollModifier({})).toBe(0);
		expect(phenomenaRollModifier({ pushLevels: 2 })).toBe(10);
		expect(phenomenaRollModifier({ sustainedCount: 1 })).toBe(10);
		expect(
			phenomenaRollModifier({ pushLevels: 3, sustainedCount: 2 }),
		).toBe(35);
	});

	test("phenomena triggers: never fettered, doubles unfettered, always push", () => {
		expect(shouldRollPhenomena("fettered", { isDouble: true })).toBe(false);
		expect(shouldRollPhenomena("fettered", { isDouble: false })).toBe(false);
		expect(shouldRollPhenomena("unfettered", { isDouble: false })).toBe(false);
		// Doubles trigger even on a failed test (p157).
		expect(shouldRollPhenomena("unfettered", { isDouble: true })).toBe(true);
		expect(shouldRollPhenomena("push", { isDouble: false })).toBe(true);
		expect(shouldRollPhenomena("push", { isDouble: true })).toBe(true);
	});

	test("phenomena roll 75+ reroutes to Perils of the Warp", () => {
		expect(phenomenaTableName(1)).toBe("Psychic Phenomena");
		expect(phenomenaTableName(74)).toBe("Psychic Phenomena");
		expect(phenomenaTableName(75)).toBe("Perils of the Warp");
		expect(phenomenaTableName(130)).toBe("Perils of the Warp");
	});

	test("91+ always fails on a Focus Power Test", () => {
		expect(focusPowerAutoFailFloor()).toBe(91);
	});
});