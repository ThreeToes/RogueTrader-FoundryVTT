import { describe, expect, test } from "bun:test";
import {
	applyVoidShields,
	crewLossFromHullDamage,
	crippledEffects,
	criticalFromCrippledDamage,
	hitsScored,
	isCritical,
	rangeModifier,
	resolveSalvoDamage,
	SHIP_CRITICALS,
	shipCritical,
} from "../src/ship-combat";

// Bead cj6k: ship combat kernel (Core Rulebook Ch. VIII pp218-223), all
// rules verified against the book layout dump before pinning here.

describe("range modifier (book p220)", () => {
	test("half range +10, beyond range -10, normal 0", () => {
		expect(rangeModifier(4, 2)).toEqual({ modifier: 10, reason: "half" });
		expect(rangeModifier(4, 4)).toEqual({ modifier: 0, reason: "normal" });
		expect(rangeModifier(4, 8)).toEqual({ modifier: -10, reason: "long" });
		// Twice the weapon's range is the hard maximum (book p219).
		expect(rangeModifier(4, 9).modifier).toBe(-10);
	});
});

describe("hits scored (book p220)", () => {
	test("macrobattery: 1 hit + 1 per degree, capped by Strength", () => {
		expect(hitsScored("macrobattery", 0, 3)).toBe(1);
		expect(hitsScored("macrobattery", 2, 3)).toBe(3);
		expect(hitsScored("macrobattery", 5, 3)).toBe(3);
	});
	test("lance: 1 hit + 1 per three degrees of success", () => {
		expect(hitsScored("lance", 2, 2)).toBe(1);
		expect(hitsScored("lance", 3, 3)).toBe(2);
		expect(hitsScored("lance", 6, 4)).toBe(3);
	});
});

describe("void shields (book p220-221)", () => {
	test("absorb hits up to shield strength, then overload", () => {
		const r = applyVoidShields(3, 1);
		expect(r).toEqual({ absorbed: 1, through: 2, overloaded: true });
	});
	test("shields stay up when hits do not reach their strength", () => {
		const r = applyVoidShields(1, 2);
		expect(r).toEqual({ absorbed: 1, through: 0, overloaded: false });
	});
});

describe("damage vs armour (book p220-221)", () => {
	test("armour subtracts from the combined damage total", () => {
		expect(resolveSalvoDamage({ damageTotal: 16, armour: 15, lance: false })).toEqual({
			hullDamage: 1,
			armourAbsorbed: 15,
		});
		expect(resolveSalvoDamage({ damageTotal: 10, armour: 15, lance: false })).toEqual({
			hullDamage: 0,
			armourAbsorbed: 10,
		});
	});
	test("lances ignore armour entirely (book p220)", () => {
		expect(resolveSalvoDamage({ damageTotal: 9, armour: 15, lance: true })).toEqual({
			hullDamage: 9,
			armourAbsorbed: 0,
		});
	});
});

describe("book worked example (p221, Sabre vs raider)", () => {
	test("macrobattery: 3 hits, 1 absorbed, 16 damage vs armour 15 -> 1 HI", () => {
		const hits = hitsScored("macrobattery", 2, 3);
		expect(hits).toBe(3);
		const shields = applyVoidShields(hits, 1);
		expect(shields.through).toBe(2);
		const outcome = resolveSalvoDamage({ damageTotal: 16, armour: 15, lance: false });
		expect(outcome.hullDamage).toBe(1);
	});
	test("lance follow-up hits the unshielded raider for full damage", () => {
		const hits = hitsScored("lance", 4, 4);
		expect(hits).toBe(2);
		expect(isCritical(4, 4)).toBe(true);
		const outcome = resolveSalvoDamage({ damageTotal: 9, armour: 15, lance: true });
		expect(outcome.hullDamage).toBe(9);
	});
});

describe("crew population/morale (book p221)", () => {
	test("each point of Hull Integrity lost costs 1 crew and 1 morale", () => {
		expect(crewLossFromHullDamage(5)).toEqual({ population: 5, morale: 5 });
		expect(crewLossFromHullDamage(0)).toEqual({ population: 0, morale: 0 });
	});
});

describe("critical hits (book p220-222)", () => {
	test("degrees meeting the Crit Rating critical", () => {
		expect(isCritical(4, 4)).toBe(true);
		expect(isCritical(3, 4)).toBe(false);
		expect(isCritical(5, 0)).toBe(false); // no Crit Rating -> never
	});
	test("Table 8-12 chart entries (book p222)", () => {
		expect(shipCritical(1)?.key).toBe("holed");
		expect(shipCritical(5)?.key).toBe("fire");
		expect(shipCritical(8)?.key).toBe("decapitation");
		expect(shipCritical(9)?.key).toBe("hull-breach");
		expect(shipCritical(10)?.key).toBe("hull-breach");
		expect(shipCritical(11)?.key).toBe("catastrophic-damage");
		expect(shipCritical(12)?.key).toBe("catastrophic-overload");
		expect(shipCritical(0)?.key).toBe("holed"); // clamped
		expect(shipCritical(99)?.key).toBe("catastrophic-overload");
	});
	test("chart covers 1-12 with no gaps", () => {
		for (let roll = 1; roll <= 12; roll++) {
			expect(shipCritical(roll)).not.toBeNull();
		}
		expect(SHIP_CRITICALS.length).toBe(11); // 9-10 share an entry
	});
	test("crippled damage past armour reads as the chart value (book p221)", () => {
		expect(criticalFromCrippledDamage(5)?.key).toBe("fire");
		expect(criticalFromCrippledDamage(12)?.key).toBe("catastrophic-overload");
	});
});

describe("crippled ships (book p221)", () => {
	test("0 Hull Integrity cripples the ship", () => {
		expect(crippledEffects(0)).toEqual({
			crippled: true,
			manoeuvrabilityPenalty: -10,
			detectionPenalty: -10,
			speedHalved: true,
			weaponStrengthHalved: true,
		});
	});
	test("positive Hull Integrity leaves the ship uncrippled", () => {
		expect(crippledEffects(1).crippled).toBe(false);
		expect(crippledEffects(1).manoeuvrabilityPenalty).toBe(0);
	});
});