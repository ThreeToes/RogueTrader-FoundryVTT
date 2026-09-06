import { describe, expect, test } from "bun:test";
import {
	availableRows,
	characteristicNextAdvance,
	derivedRank,
	ELITE_ADVANCE_BASE_COST,
	eliteLedgerEntry,
	ledgerEntryFor,
	multiplierRemaining,
	PRE_SPENT_BASELINE,
	rankProgress,
	spentOnRank,
	totalSpent,
	validatePurchase,
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	type RankThresholdLike,
} from "./advancement";

/** Table 2-2 thresholds (Core Rulebook p38). */
const RANKS: RankThresholdLike[] = [
	{ rank: 1, xpLevel: 5000 },
	{ rank: 2, xpLevel: 7000 },
	{ rank: 3, xpLevel: 10000 },
	{ rank: 4, xpLevel: 13000 },
];

describe("totalSpent (Core Rulebook p13)", () => {
	test("baseline is 4,500 before any purchases", () => {
		expect(PRE_SPENT_BASELINE).toBe(4500);
		expect(totalSpent([])).toBe(4500);
	});

	test("ledger entries add on top of the baseline", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
			{ type: "characteristic", key: "", name: "WS", cost: 250, rank: 0, characteristic: "ws", tier: "simple" },
		];
		expect(totalSpent(ledger)).toBe(4850);
	});

	test("spentOnRank groups by rank", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "a", name: "A", cost: 100, rank: 1 },
			{ type: "skill", key: "b", name: "B", cost: 100, rank: 1 },
			{ type: "talent", key: "c", name: "C", cost: 500, rank: 2 },
		];
		expect(spentOnRank(ledger, 1)).toBe(200);
		expect(spentOnRank(ledger, 2)).toBe(500);
		expect(spentOnRank(ledger, 3)).toBe(0);
	});
});

describe("derivedRank (Table 2-2, Core Rulebook p38)", () => {
	test("4,500 baseline is below rank 1 threshold", () => {
		expect(derivedRank(RANKS, 4500)).toBe(1);
	});

	test("thresholds map spent to ranks", () => {
		expect(derivedRank(RANKS, 5000)).toBe(1);
		expect(derivedRank(RANKS, 6999)).toBe(1);
		expect(derivedRank(RANKS, 7000)).toBe(2);
		expect(derivedRank(RANKS, 9999)).toBe(2);
		expect(derivedRank(RANKS, 10000)).toBe(3);
		expect(derivedRank(RANKS, 34999)).toBe(4);
		expect(derivedRank(RANKS, 99999)).toBe(4); // capped at last threshold
	});

	test("rank rises automatically once the threshold is crossed (p38)", () => {
		const spent = totalSpent([
			{ type: "skill", key: "x", name: "X", cost: 2000, rank: 1 },
		]);
		// 4500 + 2000 = 6500 -> still rank 1; +500 more crosses to rank 2.
		expect(derivedRank(RANKS, spent)).toBe(1);
		expect(derivedRank(RANKS, spent + 500)).toBe(2);
	});
});

describe("rankProgress", () => {
	test("reports next threshold and remaining xp", () => {
		const progress = rankProgress(RANKS, 6500);
		expect(progress.nextRank).toBe(2);
		expect(progress.nextXpLevel).toBe(7000);
		expect(progress.remaining).toBe(500);
	});

	test("nulls at the top rank", () => {
		const progress = rankProgress(RANKS, 34000);
		expect(progress.nextRank).toBeNull();
		expect(progress.remaining).toBe(0);
	});
});

describe("availableRows (p38: any rank held or previously held)", () => {
	const rows: AdvanceRowLike[] = [
		{ key: "a", name: "A", type: "skill", cost: 100, multiplier: 1, prerequisites: [], rank: 1 },
		{ key: "b", name: "B", type: "talent", cost: 200, multiplier: 1, prerequisites: [], rank: 2 },
		{ key: "c", name: "C", type: "talent", cost: 300, multiplier: 1, prerequisites: [], rank: 3 },
	];

	test("only ranks up to the derived rank are available", () => {
		expect(availableRows(rows, 1).map((r) => r.key)).toEqual(["a"]);
		expect(availableRows(rows, 2).map((r) => r.key)).toEqual(["a", "b"]);
		expect(availableRows(rows, 3).map((r) => r.key)).toEqual(["a", "b", "c"]);
	});
});

describe("multiplierRemaining (p39)", () => {
	const row: AdvanceRowLike = {
		key: "sound-constitution",
		name: "Sound Constitution",
		type: "talent",
		cost: 100,
		multiplier: 2,
		prerequisites: [],
		rank: 1,
	};

	test("full multiplier available before any purchase", () => {
		expect(multiplierRemaining(row, [])).toBe(2);
	});

	test("decreases per purchase of the same row", () => {
		const ledger = [
			ledgerEntryFor(row, "rogue-trader"),
		];
		expect(multiplierRemaining(row, ledger)).toBe(1);
	});

	test("different ranks are separate pools", () => {
		const otherRank = { ...row, rank: 2 };
		const ledger = [ledgerEntryFor(otherRank, "rogue-trader")];
		expect(multiplierRemaining(row, ledger)).toBe(2);
	});

	test("zero remaining after exhausting the multiplier", () => {
		const ledger = [ledgerEntryFor(row), ledgerEntryFor(row)];
		expect(multiplierRemaining(row, ledger)).toBe(0);
	});
});

describe("characteristicNextAdvance (p38)", () => {
	const scheme = { simple: 250, intermediate: 500, trained: 750, expert: 1000 };

	test("tiers consumed in order, cumulative costs", () => {
		expect(characteristicNextAdvance(scheme, 0)).toEqual({ tier: "simple", cost: 250 });
		expect(characteristicNextAdvance(scheme, 1)).toEqual({ tier: "intermediate", cost: 500 });
		expect(characteristicNextAdvance(scheme, 2)).toEqual({ tier: "trained", cost: 750 });
		expect(characteristicNextAdvance(scheme, 3)).toEqual({ tier: "expert", cost: 1000 });
	});

	test("null after Expert", () => {
		expect(characteristicNextAdvance(scheme, 4)).toBeNull();
	});

	test("cost 0 in the scheme means not available", () => {
		const restricted = { simple: 0, intermediate: 0, trained: 0, expert: 0 };
		expect(characteristicNextAdvance(restricted, 0)).toBeNull();
	});
});

describe("validatePurchase (soft enforcement, g7k 4)", () => {
	const row: AdvanceRowLike = {
		key: "charm",
		name: "Charm",
		type: "skill",
		cost: 100,
		multiplier: 1,
		prerequisites: [],
		rank: 1,
	};

	test("clean purchase passes with no reasons", () => {
		const result = validatePurchase(row, {
			spent: 4500,
			pool: 500,
			ledger: [],
			derivedRank: 1,
		});
		expect(result.ok).toBe(true);
		expect(result.reasons).toHaveLength(0);
	});

	test("prerequisites are the evaluator's job (tfk) — none emitted here", () => {
		const gated = { ...row, prerequisites: ["Fel 30"] };
		const result = validatePurchase(gated, {
			spent: 4500,
			pool: 500,
			ledger: [],
			derivedRank: 1,
		});
		expect(result.reasons).toHaveLength(0);
	});

	test("unaffordable purchase reports the shortfall", () => {
		const result = validatePurchase(row, {
			spent: 4500,
			pool: 50,
			ledger: [],
			derivedRank: 1,
		});
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("remaining pool");
	});

	test("out-of-rank rows are flagged", () => {
		const result = validatePurchase(
			{ ...row, rank: 3 },
			{ spent: 4500, pool: 500, ledger: [], derivedRank: 1 },
		);
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("beyond the character's current rank");
	});

	test("exhausted multiplier is flagged", () => {
		const multi = { ...row, multiplier: 1 };
		const result = validatePurchase(multi, {
			spent: 4500,
			pool: 500,
			ledger: [ledgerEntryFor(multi)],
			derivedRank: 1,
		});
		expect(result.ok).toBe(false);
	});

	test("prereq strings no longer emit reasons here (evaluator owns them, tfk)", () => {
		const gated = { ...row, prerequisites: ["Fel 40"] };
		const result = validatePurchase(gated, {
			spent: 4500,
			pool: 500,
			ledger: [],
			derivedRank: 1,
		});
		expect(result.reasons).toHaveLength(0);
	});
});

describe("elite advances (p39)", () => {
	test("base cost is 500 and recorded at rank 0", () => {
		const entry = eliteLedgerEntry("skill", "Trade (Miner)");
		expect(entry.cost).toBe(ELITE_ADVANCE_BASE_COST);
		expect(entry.cost).toBe(500);
		expect(entry.rank).toBe(0);
		expect(entry.elite).toBe(true);
	});
});