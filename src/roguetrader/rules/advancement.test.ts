import { describe, expect, test } from "bun:test";
import {
	availableRows,
	characteristicNextAdvance,
	derivedRank,
	ELITE_ADVANCE_BASE_COST,
	eliteLedgerEntry,
	evaluateAlternateRankGate,
	ledgerEntryFor,
	multiplierRemaining,
	PRE_SPENT_BASELINE,
	rankProgress,
	spentOnRank,
	totalSpent,
	validatePurchase,
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	type AlternateGateContext,
	type AlternateRankGate,
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

// Bead g45s: alternate/elite ranks become offerable only once their printed
// gates are structured. These fixtures use the book's OWN gate wording shapes
// (verified against the extracted metadata) rather than a copy of the pack.
describe("evaluateAlternateRankGate (bead g45s)", () => {
	const gate = (over: Partial<AlternateRankGate> = {}): AlternateRankGate => ({
		requiredCareer: "",
		requiredRace: "",
		alternateRank: "",
		requirements: "",
		otherRequirements: "",
		...over,
	});
	const context = (over: Partial<AlternateGateContext> = {}): AlternateGateContext => ({
		careerKey: "seneschal",
		careerName: "Seneschal",
		speciesKey: "",
		speciesLabel: "",
		rank: 3,
		spent: 10000,
		characteristics: { fel: 40, int: 45 },
		ownedTalents: [],
		ownedSkills: [],
		psyRating: 0,
		psyker: false,
		...over,
	});

	test("a matching Required Career and met rank/xp is eligible", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Seneschal", alternateRank: "3 (10,000 xp) or higher" }),
			context(),
		);
		expect(result.eligible).toBe(true);
		expect(result.reasons).toEqual([]);
		expect(result.minRank).toBe(3);
		expect(result.minXp).toBe(10000);
	});

	test("a non-matching Required Career is a hard fail", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Void-master" }),
			context(),
		);
		expect(result.eligible).toBe(false);
		expect(result.reasons.join(" ")).toContain("Requires Career");
	});

	test("rank and xp floors below the printed value are hard fails", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any", alternateRank: "Rank 4 or Higher (13,000 xp)" }),
			context({ rank: 2, spent: 7000 }),
		);
		expect(result.eligible).toBe(false);
		expect(result.reasons.join(" ")).toContain("Requires Rank 4");
		expect(result.reasons.join(" ")).toContain("Requires 13000 xp");
	});

	test("Any + except excludes the named career", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any, except Explorator, Missionary, Ork, and Kroot." }),
			context({ careerKey: "explorator", careerName: "Explorator" }),
		);
		expect(result.eligible).toBe(false);
		expect(result.reasons.join(" ")).toContain("not permitted");
	});

	test("Any + except passes a career not on the exclusion list", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any, except Explorator, Missionary, Ork, and Kroot." }),
			context({ careerKey: "seneschal", careerName: "Seneschal" }),
		);
		expect(result.eligible).toBe(true);
	});

	test("Any human rejects a xeno but passes a human", () => {
		const human = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any human" }),
			context(),
		);
		expect(human.eligible).toBe(true);
		const xeno = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any human" }),
			context({ speciesKey: "ork", speciesLabel: "Ork" }),
		);
		expect(xeno.eligible).toBe(false);
	});

	test("Any Non-Psyker rejects a psyker", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any Non-Psyker Explorer" }),
			context({ psyker: true, psyRating: 2 }),
		);
		expect(result.eligible).toBe(false);
		expect(result.reasons.join(" ")).toContain("non-psyker");
	});

	test("Required Race matches the career's species key or label", () => {
		const kroot = evaluateAlternateRankGate(
			gate({ requiredRace: "Kroot" }),
			context({ speciesKey: "kroot", speciesLabel: "Kroot" }),
		);
		expect(kroot.eligible).toBe(true);
		const human = evaluateAlternateRankGate(gate({ requiredRace: "Kroot" }), context());
		expect(human.eligible).toBe(false);
	});

	test("Requirements are SOFT notes, not hard fails", () => {
		const result = evaluateAlternateRankGate(
			gate({
				requiredCareer: "Any",
				requirements: "Ag 35, Pilot (Any One)",
				otherRequirements: "Must have flown a voidship.",
			}),
			context({ characteristics: { ag: 20 } }),
		);
		expect(result.eligible).toBe(true);
		expect(result.notes.join(" ")).toContain("AG 35");
		expect(result.notes.join(" ")).toContain("flown a voidship");
	});

	test("a met Requirement adds no note", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any", requirements: "Ag 35" }),
			context({ characteristics: { ag: 40 } }),
		);
		expect(result.notes).toEqual([]);
	});

	test("an owned skill satisfies a named Requirement", () => {
		const result = evaluateAlternateRankGate(
			gate({ requiredCareer: "Any", requirements: "Tech-Use +10" }),
			context({ ownedSkills: ["Tech-Use"] }),
		);
		expect(result.notes).toEqual([]);
	});
});