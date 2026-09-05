import { describe, expect, test } from "bun:test";
import { carriedWeight, deriveCapacity, resolveEncumbrance } from "./encumbrance";

describe("resolveEncumbrance", () => {
	test("no capacity set = ok, ratio 0", () => {
		const out = resolveEncumbrance(50, 0);
		expect(out.state).toBe("ok");
		expect(out.ratio).toBe(0);
		expect(out.percent).toBe(0);
	});

	test("under threshold = ok", () => {
		const out = resolveEncumbrance(40, 100);
		expect(out.state).toBe("ok");
		expect(out.percent).toBe(40);
	});

	test("at 80% = encumbered, at 100% still encumbered", () => {
		expect(resolveEncumbrance(80, 100).state).toBe("encumbered");
		expect(resolveEncumbrance(100, 100).state).toBe("encumbered");
		expect(resolveEncumbrance(100, 100).percent).toBe(100);
	});

	test("over capacity = over, percent exceeds 100", () => {
		const out = resolveEncumbrance(120, 100);
		expect(out.state).toBe("over");
		expect(out.percent).toBe(120);
	});

	test("negative inputs clamp to zero", () => {
		const out = resolveEncumbrance(-5, -10);
		expect(out.weight).toBe(0);
		expect(out.capacity).toBe(0);
		expect(out.state).toBe("ok");
	});

	test("stateLabel keys match the uppercase lang-file keys (bead n84)", () => {
		expect(resolveEncumbrance(40, 100).stateLabel).toBe("INVENTORY.STATE_OK");
		expect(resolveEncumbrance(80, 100).stateLabel).toBe(
			"INVENTORY.STATE_ENCUMBERED",
		);
		expect(resolveEncumbrance(120, 100).stateLabel).toBe(
			"INVENTORY.STATE_OVER",
		);
	});
});

describe("carriedWeight (bead yar: equip-state filter)", () => {
	test("carried weapons and gear count, stowed do not", () => {
		expect(
			carriedWeight([
				{ type: "ranged-weapon", weight: 4, equipState: "carried" },
				{ type: "melee-weapon", weight: 3, equipState: "carried" },
				{ type: "gear", weight: 10, equipState: "carried" },
				{ type: "gear", weight: 20, equipState: "stowed" },
			]),
		).toBe(17);
	});

	test("worn armour counts, stowed armour does not", () => {
		expect(
			carriedWeight([
				{ type: "armour", weight: 7, equipState: "worn" },
				{ type: "armour", weight: 15, equipState: "stowed" },
			]),
		).toBe(7);
	});

	test("worn state on weapons does not count (weapons ready = carried)", () => {
		expect(
			carriedWeight([{ type: "ranged-weapon", weight: 4, equipState: "worn" }]),
		).toBe(0);
	});

	test("missing equip state counts as stowed (raw data safe default)", () => {
		expect(carriedWeight([{ type: "gear", weight: 5 }])).toBe(0);
	});
});

describe("deriveCapacity", () => {
	test("SB x multiplier, clamped non-negative", () => {
		expect(deriveCapacity(0)).toBe(0);
		expect(deriveCapacity(3)).toBe(9);
		expect(deriveCapacity(-1)).toBe(0);
	});
});
