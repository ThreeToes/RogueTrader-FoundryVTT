import { describe, expect, test } from "bun:test";
import { parseDamageFormula, resolveDamage } from "./damage";
import { sumModifiers } from "./modifier";
import { rtCore } from "./profile";
import { locationForHit, resolveTest } from "./test";

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
	test("flatReduction (bead zyv1, trait damage-reduction) adds to soak post-Pen", () => {
		// Pen 5 eats all 3 armour; the trait's flat reduction still soaks.
		const withReduction = resolveDamage({
			roll: 12,
			penetration: 5,
			toughnessBonus: 3,
			location: "body",
			armourValue: 3,
			flatReduction: 4,
			profile: rtCore,
		});
		expect(withReduction.soak).toBe(7);
		expect(withReduction.flatReduction).toBe(4);
		expect(withReduction.wounds).toBe(5);
		expect(withReduction.absorbed).toBe(7);

		// Without the reduction: soak 3, wounds 9.
		const plain = resolveDamage({
			roll: 12,
			penetration: 5,
			toughnessBonus: 3,
			location: "body",
			armourValue: 3,
			profile: rtCore,
		});
		expect(plain.soak).toBe(3);
		expect(plain.wounds).toBe(9);
	});

	test("negative flatReduction is clamped to 0", () => {
		const outcome = resolveDamage({
			roll: 10,
			toughnessBonus: 2,
			location: "body",
			armourValue: 0,
			flatReduction: -5,
			profile: rtCore,
		});
		expect(outcome.soak).toBe(2);
	});

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
	// Core Rulebook Table 9-6: Hit Locations (printed p244): the digits of
	// the to-hit roll are REVERSED, then read as: 01-10 Head, 11-20 Right
	// Arm, 21-30 Left Arm, 31-70 Body, 71-85 Right Leg, 86-00 Left Leg.
	// Each case shows the reversed value the band is read against.
	test("reversed roll reads the Table 9-6 bands (roll -> reversed -> location)", () => {
		const cases: Array<[number, string]> = [
			// 01-10 head
			[10, "head"], // "10" -> 01
			[20, "head"], // "20" -> 02
			[90, "head"], // "90" -> 09
			[1, "head"], // "01" -> 10
			// 11-20 right-arm
			[11, "right-arm"], // "11" -> 11
			[21, "right-arm"], // "21" -> 12
			[91, "right-arm"], // "91" -> 19
			// 21-30 left-arm
			[12, "left-arm"], // "12" -> 21
			[22, "left-arm"], // "22" -> 22
			[92, "left-arm"], // "92" -> 29
			// 31-70 body
			[13, "body"], // "13" -> 31
			[7, "body"], // "07" -> 70
			[66, "body"], // "66" -> 66
			// 71-85 right-leg
			[17, "right-leg"], // "17" -> 71
			[57, "right-leg"], // "57" -> 75
			[28, "right-leg"], // "28" -> 82
			[58, "right-leg"], // "58" -> 85
			// 86-00 left-leg
			[68, "left-leg"], // "68" -> 86
			[99, "left-leg"], // "99" -> 99
		];
		for (const [roll, location] of cases) {
			expect(locationForHit(roll, rtCore)).toBe(location);
		}
	});

	test("Table 9-6 band boundaries: 10/85/86/95/00", () => {
		// Head/right-arm boundary. A ROLLED 10 reverses to "01" — the
		// 01-10 band's FIRST edge — and a rolled 11 reverses to "11", the
		// first edge of right-arm. Rolls 1 and 2 walk the same boundary from
		// the other side: "01" reverses to 10 (head band's LAST edge) and
		// "02" reverses to 20 (right-arm band's LAST edge).
		expect(locationForHit(10, rtCore)).toBe("head"); // "10" -> 01
		expect(locationForHit(11, rtCore)).toBe("right-arm"); // 11
		expect(locationForHit(1, rtCore)).toBe("head"); // "01" -> 10
		expect(locationForHit(2, rtCore)).toBe("right-arm"); // "02" -> 20
		// Body/leg edges: reversed 70 (last body, roll 7) vs 71 (first
		// right-leg, roll 17).
		expect(locationForHit(7, rtCore)).toBe("body"); // "07" -> 70
		expect(locationForHit(17, rtCore)).toBe("right-leg"); // "17" -> 71
		// Leg edges: reversed-value 85 (last right-leg, roll 58) and 86
		// (first left-leg, roll 68).
		expect(locationForHit(58, rtCore)).toBe("right-leg"); // 58 -> 85
		expect(locationForHit(57, rtCore)).toBe("right-leg"); // 57 -> 75
		expect(locationForHit(68, rtCore)).toBe("left-leg"); // 68 -> 86
		expect(locationForHit(78, rtCore)).toBe("left-leg"); // 78 -> 87
		// A rolled 95 reads as 59 -> body, not a leg.
		expect(locationForHit(95, rtCore)).toBe("body"); // 95 -> 59
		// A rolled 00/100 reads as 100 -> left-leg.
		expect(locationForHit(0, rtCore)).toBe("left-leg"); // 00 -> 100
		expect(locationForHit(100, rtCore)).toBe("left-leg");
	});

	test("out-of-band table falls back to body", () => {
		expect(locationForHit(10, { ...rtCore, hitLocations: {} })).toBe("body");
		expect(locationForHit(23, rtCore)).toBe("body"); // 23 -> 32: inside 31-70
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
