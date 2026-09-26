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
import { totalSpent } from "./advancement";
import { resolveFireModeBonus, resolvePushCap } from "./homebrew";
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
};

describe("system-profile data", () => {
	test("rtCore carries the Core Rulebook values as data", () => {
		expect(rtCore.id).toBe("rt-core");
		expect(rtCore.characteristicBase).toBe(25);
		expect(rtCore.pointBuyBudget).toBe(100);
		expect(rtCore.pointBuyMax).toBe(20);
		expect(rtCore.creatorLastStep).toBe(4);
		expect(rtCore.preSpentBaseline).toBe(4500);
		expect(rtCore.fireModeBonus).toEqual({ burst: 10, full: 20 });
		expect(rtCore.pushCap).toEqual({ sanctioned: 3, other: 4 });
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
		expect(rtCore.righteousFury).toEqual({ enabled: true, trigger: "damaging-hit" });
		expect(vocab?.keys).toEqual([
			"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
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
		expect(totalSpent([{ type: "talent", key: "", name: "X", cost: 100, rank: 1 }], SIBLING)).toBe(
			SIBLING.preSpentBaseline + 100,
		);
	});

	test("resolveFireModeBonus falls back to the profile, override wins", () => {
		expect(resolveFireModeBonus(undefined, "burst", SIBLING)).toBe(
			SIBLING.fireModeBonus.burst,
		);
		expect(
			resolveFireModeBonus({ id: "h", fireModeBonus: { burst: 5, full: 6 } }, "full", SIBLING),
		).toBe(6);
		expect(resolveFireModeBonus(undefined, "single", SIBLING)).toBeNull();
	});

	test("resolvePushCap falls back to the profile, override wins", () => {
		expect(resolvePushCap(undefined, false, SIBLING)).toBe(SIBLING.pushCap.other);
		expect(resolvePushCap({ id: "h", pushCap: { sanctioned: 1, other: 2 } }, true, SIBLING)).toBe(1);
	});
});