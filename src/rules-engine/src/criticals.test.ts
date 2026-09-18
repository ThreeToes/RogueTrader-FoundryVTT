import { describe, expect, test } from "bun:test";
import {
	BATTLESUIT_CRITICAL_TABLE,
	battlesuitSuffersCritical,
	criticalRegion,
	criticalSeverity,
	criticalTableName,
	MAX_CRITICAL_SEVERITY,
	repairEffectCount,
	splitWoundDamage,
} from "./criticals";

/**
 * Character critical maths. The two rules under test that are NOT core-book
 * generic come from the Tau Character Guide p31 (the battlesuit 1d10 override
 * and its repair test); the rest is the core Critical Damage flow.
 */
describe("critical region mapping", () => {
	test("the six body locations fold onto the book's four regions", () => {
		expect(criticalRegion("head")).toBe("Head");
		expect(criticalRegion("body")).toBe("Body");
		expect(criticalRegion("left-arm")).toBe("Arm");
		expect(criticalRegion("right-arm")).toBe("Arm");
		expect(criticalRegion("left-leg")).toBe("Leg");
		expect(criticalRegion("right-leg")).toBe("Leg");
	});

	test("an unknown or empty location defaults to Body rather than throwing", () => {
		expect(criticalRegion("")).toBe("Body");
		expect(criticalRegion(null)).toBe("Body");
		expect(criticalRegion(undefined)).toBe("Body");
		expect(criticalRegion("torso")).toBe("Body");
	});
});

describe("critical table selection", () => {
	test("names match the pack's tables", () => {
		// The criticals pack carries "Critical Hit (Energy, Head)" etc.
		expect(criticalTableName("Energy", "head")).toBe(
			"Critical Hit (Energy, Head)",
		);
		expect(criticalTableName("Rending", "right-leg")).toBe(
			"Critical Hit (Rending, Leg)",
		);
		expect(criticalTableName("Explosive", "left-arm")).toBe(
			"Critical Hit (Explosive, Arm)",
		);
		expect(criticalTableName("Impact", "body")).toBe(
			"Critical Hit (Impact, Body)",
		);
	});

	test("the battlesuit table is named as the pack entry is", () => {
		expect(BATTLESUIT_CRITICAL_TABLE).toBe("Battlesuit Critical Effects (Tau)");
	});
});

describe("critical severity", () => {
	test("accumulates existing critical damage in the location", () => {
		expect(criticalSeverity(0, 3)).toBe(3);
		expect(criticalSeverity(4, 2)).toBe(6);
	});

	test("never drops below 1 and never exceeds 10", () => {
		expect(criticalSeverity(0, 0)).toBe(1);
		expect(criticalSeverity(9, 5)).toBe(MAX_CRITICAL_SEVERITY);
		expect(criticalSeverity(12, 3)).toBe(MAX_CRITICAL_SEVERITY);
	});

	test("ignores negative inputs instead of producing nonsense", () => {
		expect(criticalSeverity(-5, 2)).toBe(2);
		expect(criticalSeverity(2, -5)).toBe(2);
	});
});

describe("damage split (the missing piece in the apply-damage flow)", () => {
	test("wounds absorb damage while any remain", () => {
		expect(splitWoundDamage(10, 4)).toEqual({ applied: 4, excess: 0 });
		expect(splitWoundDamage(10, 10)).toEqual({ applied: 10, excess: 0 });
	});

	test("everything past 0 wounds becomes critical damage", () => {
		expect(splitWoundDamage(3, 5)).toEqual({ applied: 3, excess: 2 });
		expect(splitWoundDamage(0, 7)).toEqual({ applied: 0, excess: 7 });
	});

	test("a character already on 0 wounds takes it all as critical", () => {
		expect(splitWoundDamage(0, 1)).toEqual({ applied: 0, excess: 1 });
		expect(splitWoundDamage(-2, 4)).toEqual({ applied: 0, excess: 4 });
	});

	test("no damage is a no-op", () => {
		expect(splitWoundDamage(5, 0)).toEqual({ applied: 0, excess: 0 });
	});
});

describe("battlesuit override (Tau Character Guide p31)", () => {
	test("9 or higher suffers Critical Damage as normal", () => {
		expect(battlesuitSuffersCritical(9)).toBe(true);
		expect(battlesuitSuffersCritical(10)).toBe(true);
	});

	test("8 or lower is absorbed: the battlesuit table is rolled instead", () => {
		for (let roll = 1; roll <= 8; roll++) {
			expect(battlesuitSuffersCritical(roll)).toBe(false);
		}
	});
});

describe("battlesuit repair (Tau Character Guide p31)", () => {
	test("one effect plus one per Degree of Success", () => {
		expect(repairEffectCount(0)).toBe(1);
		expect(repairEffectCount(1)).toBe(2);
		expect(repairEffectCount(3)).toBe(4);
	});

	test("a failed test removes nothing", () => {
		expect(repairEffectCount(-1)).toBe(0);
		expect(repairEffectCount(-5)).toBe(0);
	});
});
