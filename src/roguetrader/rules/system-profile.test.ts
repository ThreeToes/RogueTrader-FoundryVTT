/**
 * SystemProfile plumbing (bead yszf): the RT creation/advancement/homebrew
 * constants must live behind a profile object so a sibling 40k system can
 * supply its own values without forking the resolvers.
 */
import { describe, expect, test } from "bun:test";

import {
	CHARACTERISTIC_BASE,
	POINT_BUY_BUDGET,
	POINT_BUY_MAX,
	validatePointBuy,
} from "./creation";
import { ELITE_ADVANCE_BASE_COST, eliteLedgerEntry, totalSpent } from "./advancement";
import {
	TOXIC_PENALTY_PER_DAMAGE_POINT,
	toxicToughnessPenalty,
} from "./toxic";
import { MAX_CRITICAL_SEVERITY } from "../../rules-engine/index";
import {
	DEFAULT_SYSTEM_PROFILE,
	rtCore,
	type SystemProfile,
} from "../../ffg/domain/system-profile";

/** A sibling system with different maths (e.g. Only War-ish numbers). */
const SIBLING: SystemProfile = {
	// Composition (bead yojf): a sibling profile starts from the RT kernel
	// data (crit handling, hit locations, vocabulary) and overrides what its
	// system differs on.
	...rtCore,
	id: "ow-core",
	characteristicBase: 20,
	pointBuyBudget: 90,
	pointBuyMax: 15,
	creatorLastStep: 3,
	preSpentBaseline: 600,
	fireModeBonus: { burst: 0, full: 10 },
	pushCap: { sanctioned: 2, other: 3 },
	// Bead wxut.2 lifted constants: a sibling tunes these the same way.
	penaltyPerDamagePoint: 3,
};

describe("system-profile data", () => {
	test("rtCore carries the Core Rulebook values as data", () => {
		expect(rtCore.id).toBe("rt-core");
		expect(rtCore.characteristicBase).toBe(25);
		expect(rtCore.pointBuyBudget).toBe(100);
		expect(rtCore.pointBuyMax).toBe(20);
		// Step 5 (owner rework 2026): the Starting Kit step is the last one.
		expect(rtCore.creatorLastStep).toBe(5);
		expect(rtCore.preSpentBaseline).toBe(4500);
		expect(rtCore.fireModeBonus).toEqual({ burst: 10, full: 20 });
		expect(rtCore.pushCap).toEqual({ sanctioned: 3, other: 4 });
		// Bead tval (Core Rulebook p74 + Dodge example p244): RT Core untrained
		// skill tests target HALF the governing Characteristic, round down.
		expect(rtCore.untrainedSkill).toEqual({ model: "half-characteristic" });
	});

	test("the wxut.1 lifted fields carry their rules constants", () => {
		// Three constants moved onto the profile as data. Domain cannot
		// import the rules layer, so system-profile.ts repeats each value and
		// THIS test pins it against the rules constant that stays the source.
		// repairTestModifier is pinned in battlesuit-repair.test.ts instead:
		// importing that module here would drag this pure profile test through
		// the Foundry-coupled chain ("foundry is not defined").
		expect(rtCore.eliteAdvanceBaseCost).toBe(ELITE_ADVANCE_BASE_COST);
		expect(rtCore.penaltyPerDamagePoint).toBe(TOXIC_PENALTY_PER_DAMAGE_POINT);
		expect(rtCore.criticals?.maxSeverity).toBe(MAX_CRITICAL_SEVERITY);
		// The ammo toggle's core value is the book-accurate FALSE (epic ui4b).
		expect(rtCore.ammoAutoConsume).toBe(false);
	});

	test("resolvers default to the RT profile", () => {
		expect(DEFAULT_SYSTEM_PROFILE).toBe(rtCore);
		expect(CHARACTERISTIC_BASE).toBe(rtCore.characteristicBase);
		expect(POINT_BUY_BUDGET).toBe(rtCore.pointBuyBudget);
		expect(POINT_BUY_MAX).toBe(rtCore.pointBuyMax);
	});
});

describe("composition with the rules-engine RuleProfile (bead yojf)", () => {
	test("SystemProfile extends RuleProfile — one object carries both layers", () => {
		const vocab = rtCore.characteristics;
		// The kernel data rides on the same object: crit handling, hit
		// locations, characteristic vocabulary, wound/fate/psychic/critical
		// extension points.
		expect(rtCore.critOnDouble).toBe(true);
		expect(rtCore.righteousFury).toEqual({
			enabled: true,
			trigger: "damaging-hit",
		});
		expect(vocab?.keys).toEqual([
			"ws",
			"bs",
			"s",
			"t",
			"ag",
			"int",
			"per",
			"wp",
			"fel",
		]);
		expect(vocab?.labelPrefix).toBe("CHARACTERISTIC");
		expect(rtCore.advancement).toEqual({ xpModel: "spent-ledger" });
		expect(rtCore.startingWounds).toEqual({
			toughnessMultiplier: 2,
			dice: "",
			flat: 0,
		});
		expect(rtCore.startingFate).toEqual({ model: "bands" });
		// Null = resolved through the content port, not fabricated profile data.
		expect(rtCore.skillCatalogPack).toBeNull();
		expect(rtCore.psychic).toEqual({ phenomenaTablePack: null });
		expect(rtCore.criticalTables).toEqual({ core: null, vehicle: null });
	});

	test("a sibling profile can override the extension points", () => {
		const sibling: SystemProfile = {
			...SIBLING,
			advancement: { xpModel: "aptitudes" },
			startingFate: { model: "table" },
			skillCatalogPack: "dark-heresy-skills",
		};
		expect(sibling.advancement).toEqual({ xpModel: "aptitudes" });
		expect(sibling.startingFate).toEqual({ model: "table" });
		// Kernel defaults still present (inherited from rtCore's spread only
		// when the sibling starts from it; explicitly set otherwise).
		expect(sibling.skillCatalogPack).toBe("dark-heresy-skills");
	});
});

describe("profile-parameterized resolvers", () => {
	test("validatePointBuy honours the profile budget/cap", () => {
		const rt = validatePointBuy({ ws: rtCore.pointBuyMax, t: 20 });
		expect(rt.valid).toBe(true);
		expect(rt.remaining).toBe(rtCore.pointBuyBudget - rtCore.pointBuyMax * 2);

		const sibling = validatePointBuy({ ws: rtCore.pointBuyMax }, SIBLING);
		expect(sibling.valid).toBe(false); // 20 > 15 cap
		expect(sibling.overCap).toEqual(["ws"]);
		expect(sibling.remaining).toBe(SIBLING.pointBuyBudget - rtCore.pointBuyMax);
	});

	test("totalSpent honours the profile baseline", () => {
		expect(totalSpent([], SIBLING)).toBe(SIBLING.preSpentBaseline);
		expect(
			totalSpent(
				[{ type: "talent", key: "", name: "X", cost: 100, rank: 1 }],
				SIBLING,
			),
		).toBe(SIBLING.preSpentBaseline + 100);
	});

	// Bead wxut.2 retired the three resolve* helpers: a house rule is now a
	// knob-keyed delta merged over a base profile by effectiveProfile(), and
	// the merge/validation contract is pinned in rule-knobs.test.ts and
	// homebrew.test.ts. What remains HERE is the property that made them
	// profile-parameterised in the first place — a sibling profile's values
	// flow to the consumers that now read their own fields.
	test("a sibling profile carries its own rule values", () => {
		expect(SIBLING.fireModeBonus).toEqual({ burst: 0, full: 10 });
		expect(SIBLING.pushCap).toEqual({ sanctioned: 2, other: 3 });
		expect(SIBLING.penaltyPerDamagePoint).toBe(3);
		expect(rtCore.fireModeBonus).toEqual({ burst: 10, full: 20 });
		expect(rtCore.pushCap).toEqual({ sanctioned: 3, other: 4 });
	});

	test("eliteLedgerEntry takes its base cost from the profile", () => {
		// Bead wxut.2: ELITE_ADVANCE_BASE_COST is profile DATA. The explicit
		// argument still wins; an omitted one reads the profile.
		expect(eliteLedgerEntry("skill", "Trade (Miner)").cost).toBe(
			rtCore.eliteAdvanceBaseCost,
		);
		expect(eliteLedgerEntry("skill", "Trade (Miner)", 900).cost).toBe(900);
		expect(eliteLedgerEntry("skill", "X", undefined, SIBLING).cost).toBe(
			SIBLING.eliteAdvanceBaseCost,
		);
	});

	test("toxicToughnessPenalty takes its per-point value from the profile", () => {
		expect(toxicToughnessPenalty(1)).toBe(-rtCore.penaltyPerDamagePoint);
		expect(toxicToughnessPenalty(3)).toBe(-rtCore.penaltyPerDamagePoint * 3);
		// A sibling tuning the knob changes the arithmetic with no code branch.
		expect(toxicToughnessPenalty(2, SIBLING)).toBe(
			-SIBLING.penaltyPerDamagePoint * 2,
		);
		expect(TOXIC_PENALTY_PER_DAMAGE_POINT).toBe(5);
	});
});
