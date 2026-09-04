import { describe, expect, test } from "bun:test";
import { parseDamageFormula, resolveDamage } from "../src/damage";
import { sumModifiers } from "../src/modifier";
import { rtCore } from "../src/profile";
import { locationForHit, resolveTest } from "../src/test";

describe("resolveTest (rt-core)", () => {
	test("exact target is one degree of success", () => {
		const outcome = resolveTest({ target: 60, roll: 60, profile: rtCore });
		expect(outcome.success).toBe(true);
		expect(outcome.degrees).toBe(1);
		expect(outcome.margin).toBe(0);
	});

	test("each full 10 below the target adds a degree", () => {
		expect(resolveTest({ target: 60, roll: 51, profile: rtCore }).degrees).toBe(
			1,
		);
		expect(resolveTest({ target: 60, roll: 50, profile: rtCore }).degrees).toBe(
			2,
		);
		expect(resolveTest({ target: 60, roll: 20, profile: rtCore }).degrees).toBe(
			5,
		);
	});

	test("rolls above the target fail with zero degrees", () => {
		const outcome = resolveTest({ target: 60, roll: 61, profile: rtCore });
		expect(outcome.success).toBe(false);
		expect(outcome.degrees).toBe(0);
		expect(outcome.margin).toBe(-1);
	});

	test("doubles are reported as data", () => {
		expect(
			resolveTest({ target: 55, roll: 55, profile: rtCore }).isDouble,
		).toBe(true);
		expect(
			resolveTest({ target: 55, roll: 99, profile: rtCore }).isDouble,
		).toBe(true);
		expect(
			resolveTest({ target: 55, roll: 54, profile: rtCore }).isDouble,
		).toBe(false);
		expect(
			resolveTest({ target: 55, roll: 100, profile: rtCore }).isDouble,
		).toBe(true);
	});

	test("critical flag requires success + double + profile flag", () => {
		expect(
			resolveTest({ target: 60, roll: 55, profile: rtCore }).critical,
		).toBe(true);
		expect(
			resolveTest({ target: 40, roll: 55, profile: rtCore }).critical,
		).toBe(false);
		expect(
			resolveTest({ target: 60, roll: 22, profile: rtCore }).critical,
		).toBe(true);
	});

	test("echoes the raw roll on the outcome (bead vul)", () => {
		expect(resolveTest({ target: 60, roll: 37, profile: rtCore }).roll).toBe(
			37,
		);
	});
});

describe("sumModifiers", () => {
	test("additive stacking", () => {
		expect(
			sumModifiers([
				{
					id: "aim",
					source: { type: "dialog", label: "Aim" },
					label: "Aim",
					value: 10,
				},
				{
					id: "wound",
					source: { type: "effect", label: "Wound" },
					label: "Wound",
					value: -10,
				},
			]),
		).toBe(0);
	});
});

describe("resolveDamage (rt-core)", () => {
	test("soak = effective armour + TB, pen reduces armour only", () => {
		const outcome = resolveDamage({
			roll: 12,
			penetration: 2,
			toughnessBonus: 3,
			location: "body",
			armourValue: 5,
			profile: rtCore,
		});
		expect(outcome.effectiveArmour).toBe(3);
		expect(outcome.soak).toBe(6);
		expect(outcome.wounds).toBe(6);
		expect(outcome.absorbed).toBe(6);
		expect(outcome.penApplied).toBe(2);
	});

	test("damage never negative, penetration bounded by armour", () => {
		const outcome = resolveDamage({
			roll: 2,
			penetration: 5,
			toughnessBonus: 4,
			location: "head",
			armourValue: 3,
			profile: rtCore,
		});
		expect(outcome.penApplied).toBe(3);
		expect(outcome.effectiveArmour).toBe(0);
		expect(outcome.soak).toBe(4);
		expect(outcome.wounds).toBe(0);
	});

	test("flat damage (talent, Crushing Blow) joins the roll before soak", () => {
		// 1d10 roll of 7 + Crushing Blow's +2 = 9 total damage, all soaked
		// normally by armour + toughness.
		const outcome = resolveDamage({
			roll: 7,
			flatDamage: 2,
			toughnessBonus: 2,
			location: "body",
			armourValue: 5,
			profile: rtCore,
		});
		expect(outcome.flatDamage).toBe(2);
		expect(outcome.soak).toBe(7);
		expect(outcome.absorbed).toBe(7);
		expect(outcome.wounds).toBe(2);
	});

	test("critical damage (talent, Crack Shot) applies only on critical hits", () => {
		const base = {
			roll: 8,
			criticalDamage: 2,
			toughnessBonus: 1,
			location: "body",
			armourValue: 0,
			profile: rtCore,
		};
		const critical = resolveDamage({ ...base, isCritical: true });
		expect(critical.criticalDamage).toBe(2);
		expect(critical.wounds).toBe(9); // 8 + 2 - 1 TB

		const plain = resolveDamage({ ...base, isCritical: false });
		expect(plain.criticalDamage).toBe(0);
		expect(plain.wounds).toBe(7); // 8 - 1 TB
	});

	test("flat + critical damage are themselves soakable", () => {
		const outcome = resolveDamage({
			roll: 3,
			flatDamage: 2,
			criticalDamage: 4,
			isCritical: true,
			toughnessBonus: 3,
			location: "body",
			armourValue: 8,
			profile: rtCore,
		});
		expect(outcome.soak).toBe(11);
		expect(outcome.wounds).toBe(0); // 3 + 2 + 4 fully soaked
	});

	test("righteous fury requires trigger + damaging hit", () => {
		const damaging = resolveDamage({
			roll: 10,
			toughnessBonus: 1,
			location: "body",
			armourValue: 0,
			righteousFuryTriggered: true,
			profile: rtCore,
		});
		expect(damaging.righteousFury).toBe(true);

		// Triggered dice but fully soaked: no fury.
		const soaked = resolveDamage({
			roll: 10,
			toughnessBonus: 4,
			location: "body",
			armourValue: 6,
			righteousFuryTriggered: true,
			profile: rtCore,
		});
		expect(soaked.righteousFury).toBe(false);

		// Damaging hit but the dice never showed the trigger: no fury.
		const untriggered = resolveDamage({
			roll: 10,
			toughnessBonus: 1,
			location: "body",
			armourValue: 0,
			profile: rtCore,
		});
		expect(untriggered.righteousFury).toBe(false);
	});

	test("primitive armour rule doubles wounds (non-primitive vs primitive armour)", () => {
		const request = {
			roll: 4,
			penetration: 0,
			toughnessBonus: 0,
			location: "body",
			armourValue: 2,
			weaponPrimitive: false,
			armourPrimitive: true,
			profile: rtCore,
		};
		const doubled = resolveDamage(request);
		expect(doubled.primitiveDouble).toBe(true);
		expect(doubled.wounds).toBe(4);

		const plain = resolveDamage({
			...request,
			profile: { ...rtCore, primitiveArmourDouble: false },
		});
		expect(plain.primitiveDouble).toBe(false);
		expect(plain.wounds).toBe(2);
	});

	test("primitive weapons never trigger primitive-armour doubling", () => {
		const outcome = resolveDamage({
			roll: 6,
			toughnessBonus: 0,
			location: "body",
			armourValue: 2,
			weaponPrimitive: true,
			armourPrimitive: true,
			profile: rtCore,
		});
		expect(outcome.primitiveDouble).toBe(false);
		expect(outcome.wounds).toBe(4);
	});

	test("kernel flags, not resolves: no HP concepts leak in", () => {
		const outcome = resolveDamage({
			roll: 8,
			toughnessBonus: 2,
			location: "body",
			armourValue: 3,
			profile: rtCore,
		});
		expect(outcome.wounds).toBe(3);
		expect(Object.keys(outcome)).not.toContain("actor");
	});
});

describe("locationForHit (rt-core)", () => {
	test("tens digit maps through the profile table", () => {
		expect(locationForHit(10, rtCore)).toBe("head");
		expect(locationForHit(23, rtCore)).toBe("right-arm");
		expect(locationForHit(66, rtCore)).toBe("body");
		expect(locationForHit(89, rtCore)).toBe("right-leg");
		expect(locationForHit(5, rtCore)).toBe("left-leg");
	});

	test("unknown digits fall back to body", () => {
		expect(locationForHit(5, { ...rtCore, hitLocations: {} })).toBe("body");
	});
});

describe("parseDamageFormula (bead 6tr)", () => {
	test("strips a trailing damage-type letter and normalises it", () => {
		expect(parseDamageFormula("1d10+4 E")).toEqual({
			formula: "1d10+4",
			type: "Energy",
		});
	});

	test("maps each type letter to its canonical value", () => {
		expect(parseDamageFormula("2d5 I").type).toBe("Impact");
		expect(parseDamageFormula("1d10 R").type).toBe("Rending");
		expect(parseDamageFormula("1d10 S").type).toBe("Rending");
		expect(parseDamageFormula("1d10+2 X").type).toBe("Explosive");
	});

	test("leaves bare formulas untouched", () => {
		expect(parseDamageFormula("1d10+4")).toEqual({
			formula: "1d10+4",
			type: null,
		});
		expect(parseDamageFormula("1d5")).toEqual({ formula: "1d5", type: null });
	});

	test("does not eat letters inside the formula", () => {
		expect(parseDamageFormula("1d10+SB")).toEqual({
			formula: "1d10+SB",
			type: null,
		});
	});
});
