import { describe, expect, test } from "bun:test";
import { resolveDamage } from "../src/damage";
import { sumModifiers } from "../src/modifier";
import { rtCore } from "../src/profile";
import { resolveTest } from "../src/test";

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
	const armour = { head: 3, body: 5 };

	test("soak reduces damage per location, penetration reduces armour only", () => {
		const outcome = resolveDamage({
			roll: 12,
			penetration: 2,
			toughnessBonus: 3,
			armour,
		});
		const body = outcome.locations.find((l) => l.location === "body")!;
		// effective armour 5-2=3, soak 3+3=6, damage 12-6=6
		expect(body.soak).toBe(6);
		expect(body.damage).toBe(6);
		// head: armour 3-2=1, soak 3+1=4 -> damage 8
		const head = outcome.locations.find((l) => l.location === "head");
		expect(head?.damage).toBe(8);
	});

	test("damage never goes negative and soak never below TB", () => {
		const outcome = resolveDamage({
			roll: 2,
			penetration: 5,
			toughnessBonus: 4,
			armour,
		});
		const body = outcome.locations.find((l) => l.location === "body")!;
		expect(body.effectiveArmour).toBe(0);
		expect(body.soak).toBe(4);
		expect(body.damage).toBe(0);
	});
});
