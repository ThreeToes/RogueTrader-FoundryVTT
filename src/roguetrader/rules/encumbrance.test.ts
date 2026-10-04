import { describe, expect, test } from "bun:test";
import {
	actorEncumbrance,
	carryingCapacity,
	CARRYING_WEIGHT_TABLE,
	carriedWeight,
	LIFTING_WEIGHT_TABLE,
	PUSHING_WEIGHT_TABLE,
	resolveEncumbrance,
} from "./encumbrance";

describe("Table 9-33 data (Core Rulebook p268, verified vs page-0269.raw)", () => {
	test("all three columns are 21 rows (SB+TB 0..20)", () => {
		expect(CARRYING_WEIGHT_TABLE).toHaveLength(21);
		expect(LIFTING_WEIGHT_TABLE).toHaveLength(21);
		expect(PUSHING_WEIGHT_TABLE).toHaveLength(21);
	});

	test("carrying capacity spot-checks (bead qhkv rows)", () => {
		// SB+TB: 4 -> 18, 8 -> 56, 12 -> 112, clamp at 20 -> 2250
		expect(carryingCapacity(4)).toBe(18);
		expect(carryingCapacity(8)).toBe(56);
		expect(carryingCapacity(12)).toBe(112);
		expect(carryingCapacity(20)).toBe(2250);
	});

	test("carrying capacity clamps outside the table range", () => {
		expect(carryingCapacity(25)).toBe(2250); // clamped at the top row
		expect(carryingCapacity(0)).toBe(0.9);
		expect(carryingCapacity(-3)).toBe(0.9); // clamped at the bottom row
		expect(carryingCapacity(4.7)).toBe(18); // floored to the printed row
	});

	test("a typical SB4/TB4 explorer carries 56 kg, not 12", () => {
		// The old code derived SB x 3 = 12; the book's table at SB+TB 8 is 56.
		expect(carryingCapacity(4 + 4)).toBe(56); // SB4/TB4 explorer
	});
});

describe("resolveEncumbrance (book states, p268)", () => {
	test("at or under Carrying Weight = ok", () => {
		expect(resolveEncumbrance(56, 56, 112).state).toBe("ok");
		expect(resolveEncumbrance(40, 56, 112).state).toBe("ok");
	});

	test("just over Carrying Weight = encumbered (book boundary: above carrying)", () => {
		expect(resolveEncumbrance(56.1, 56, 112).state).toBe("encumbered");
		expect(resolveEncumbrance(100, 56, 112).state).toBe("encumbered");
	});

	test("past Lifting Weight = over (UI band, not a book state)", () => {
		expect(resolveEncumbrance(113, 56, 112).state).toBe("over");
	});

	test("no lifting data: weight above capacity is over (bar keeps working)", () => {
		const out = resolveEncumbrance(120, 100);
		expect(out.state).toBe("over");
		expect(out.percent).toBe(120);
	});

	test("no capacity: ok with ratio 0 (advisory, never a gate)", () => {
		const out = resolveEncumbrance(50, 0);
		expect(out.state).toBe("ok");
		expect(out.ratio).toBe(0);
	});

	test("negative inputs clamp to zero", () => {
		const out = resolveEncumbrance(-5, -10);
		expect(out.weight).toBe(0);
		expect(out.capacity).toBe(0);
		expect(out.state).toBe("ok");
	});

	test("stateLabel keys match the uppercase lang-file keys (bead n84)", () => {
		expect(resolveEncumbrance(40, 56, 112).stateLabel).toBe("INVENTORY.STATE_OK");
		expect(resolveEncumbrance(60, 56, 112).stateLabel).toBe(
			"INVENTORY.STATE_ENCUMBERED",
		);
		expect(resolveEncumbrance(120, 56, 112).stateLabel).toBe(
			"INVENTORY.STATE_OVER",
		);
	});
});

describe("carriedWeight (owner decisions xhcc: stowed counts; 1sxq: quantity x)", () => {
	test("everything counts regardless of equip state", () => {
		expect(
			carriedWeight([
				{ type: "ranged-weapon", weight: 4, equipState: "carried" },
				{ type: "melee-weapon", weight: 3, equipState: "stowed" },
				{ type: "gear", weight: 10, equipState: "carried" },
				{ type: "gear", weight: 20, equipState: "stowed" },
			]),
		).toBe(37);
	});

	test("each stack's weight x quantity", () => {
		expect(
			carriedWeight([
				{ type: "gear", weight: 5, quantity: 3 },
				{ type: "gear", weight: 5, quantity: 3 },
			]),
		).toBe(30); // 2 x (5 x 3)
	});

	test("quantity absent counts one", () => {
		expect(carriedWeight([{ type: "gear", weight: 5 }])).toBe(5);
	});

	test("quantity 0 (spent/depleted stack) weighs nothing", () => {
		expect(carriedWeight([{ type: "gear", weight: 5, quantity: 0 }])).toBe(0);
	});

	test("negative weight and quantity clamp to zero per item", () => {
		expect(
			carriedWeight([
				{ type: "gear", weight: -5, quantity: 2 },
				{ type: "gear", weight: 3, quantity: -1 },
			]),
		).toBe(0);
	});
});

describe("actorEncumbrance", () => {
	const item = (weight: number, extra: Record<string, unknown> = {}) => ({
		type: "gear",
		system: { weight, ...extra },
	});

	test("capacity comes from Table 9-33 at SB+TB (typical explorer: 56)", () => {
		const out = actorEncumbrance([item(10)], 4 + 4);
		expect(out.capacity).toBe(56);
		expect(out.weight).toBe(10);
		expect(out.state).toBe("ok");
		expect(out.percent).toBe(18); // 10/56, rounded
	});

	test("item quantity multiplies into the load", () => {
		expect(
			actorEncumbrance([item(5, { quantity: 3 })], 4 + 4).weight,
		).toBe(15);
	});

	test("state boundaries per the book: <= carrying ok; 56.1 encumbered", () => {
		expect(actorEncumbrance([item(56)], 4 + 4).state).toBe("ok");
		expect(actorEncumbrance([item(56.1)], 4 + 4).state).toBe("encumbered");
		expect(actorEncumbrance([item(120)], 4 + 4).state).toBe("over"); // past lifting 112
	});

	test("non-carried item types are ignored", () => {
		const out = actorEncumbrance(
			[
				{ type: "talent", system: { weight: 999 } },
				{ type: "special-ability", system: { weight: 999 } },
			],
			4 + 4,
		);
		expect(out.weight).toBe(0);
	});

	test("manual capacity override wins over the table default", () => {
		const out = actorEncumbrance([item(40)], 4 + 4, 30);
		expect(out.capacity).toBe(30);
		expect(out.state).toBe("over"); // above the manual cap the taker set
		expect(actorEncumbrance([item(25)], 4 + 4, 30).state).toBe("ok");
	});

	test("override 0 falls back to the table", () => {
		expect(actorEncumbrance([], 4 + 4, 0).capacity).toBe(56);
	});
});