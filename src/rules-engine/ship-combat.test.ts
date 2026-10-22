import { describe, expect, test } from "bun:test";
import {
	applyVoidShields,
	combinedTarget,
	composeSalvoDamageFormula,
	crewLossFromHullDamage,
	crippledEffects,
	criticalFromCrippledDamage,
	emergencyRepairsCanFix,
	emergencyRepairsOutcome,
	componentFunctional,
	hitsScored,
	HAZARD_CREW_DAMAGE,
	isCritical,
	rangeModifier,
	resolveSalvoDamage,
	salvoWeaponKind,
	SHIP_CRITICALS,
	SHIP_WEAPON_KINDS,
	shipCritical,
	shipWeaponKindSpec,
	VENT_FIRE_CREW_DAMAGE,
} from "./ship-combat";

// Bead cj6k: ship combat kernel (Core Rulebook Ch. VIII pp218-223), all
// rules verified against the book layout dump before pinning here.

describe("range modifier (book p220)", () => {
	test("half range +10, beyond range -10, normal 0", () => {
		expect(rangeModifier(4, 2)).toEqual({ modifier: 10, reason: "half" });
		expect(rangeModifier(4, 4)).toEqual({ modifier: 0, reason: "normal" });
		expect(rangeModifier(4, 8)).toEqual({ modifier: -10, reason: "long" });
	});
	test("twice the weapon's range is the hard maximum (book p219)", () => {
		// Exactly 2x range is still fireable at -10...
		expect(rangeModifier(4, 8).modifier).toBe(-10);
		// ...beyond it the shot is refused outright, not fired at -10.
		expect(rangeModifier(4, 9)).toEqual({
			modifier: 0,
			reason: "out-of-range",
		});
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
		expect(
			resolveSalvoDamage({ damageTotal: 16, armour: 15, lance: false }),
		).toEqual({
			hullDamage: 1,
			armourAbsorbed: 15,
		});
		expect(
			resolveSalvoDamage({ damageTotal: 10, armour: 15, lance: false }),
		).toEqual({
			hullDamage: 0,
			armourAbsorbed: 10,
		});
	});
	test("lances ignore armour entirely (book p220)", () => {
		expect(
			resolveSalvoDamage({ damageTotal: 9, armour: 15, lance: true }),
		).toEqual({
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
		const outcome = resolveSalvoDamage({
			damageTotal: 16,
			armour: 15,
			lance: false,
		});
		expect(outcome.hullDamage).toBe(1);
	});
	test("lance follow-up hits the unshielded raider for full damage", () => {
		const hits = hitsScored("lance", 4, 4);
		expect(hits).toBe(2);
		expect(isCritical(4, 4)).toBe(true);
		const outcome = resolveSalvoDamage({
			damageTotal: 9,
			armour: 15,
			lance: true,
		});
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

describe("component states + repairs (book p223-224, bead cj6k)", () => {
	test("functional components", () => {
		expect(componentFunctional(undefined)).toBe(true);
		expect(componentFunctional("intact")).toBe(true);
		expect(componentFunctional("unpowered")).toBe(true);
		expect(componentFunctional("damaged")).toBe(false);
		expect(componentFunctional("destroyed")).toBe(false);
	});

	test("Emergency Repairs eligibility (book p218)", () => {
		expect(emergencyRepairsCanFix("unpowered")).toBe(true);
		expect(emergencyRepairsCanFix("damaged")).toBe(true);
		expect(emergencyRepairsCanFix(undefined, true)).toBe(true); // depressurised
		expect(emergencyRepairsCanFix("intact")).toBe(false);
		expect(emergencyRepairsCanFix("destroyed")).toBe(false);
	});

	test("repair time: 1d5 turns, -1 per degree, minimum one (book p218)", () => {
		expect(emergencyRepairsOutcome(0, 5).turns).toBe(5);
		expect(emergencyRepairsOutcome(2, 5).turns).toBe(3);
		expect(emergencyRepairsOutcome(9, 5).turns).toBe(1); // clamped
		// The die result is consumed, not a hard-coded 5 (bead 5lnc).
		expect(emergencyRepairsOutcome(1, 2).turns).toBe(1);
		expect(emergencyRepairsOutcome(1, 5).turns).toBe(4);
	});

	test("hazard crew damage dice (book p223-224)", () => {
		expect(HAZARD_CREW_DAMAGE.fire).toMatchObject({
			populationFaces: 5,
			moraleFaces: 10,
		});
		expect(HAZARD_CREW_DAMAGE.depressurisation).toMatchObject({
			populationFaces: 10,
			moraleFaces: 5,
		});
		expect(VENT_FIRE_CREW_DAMAGE).toMatchObject({
			populationFaces: 5,
			moraleDice: 2,
			moraleFaces: 10,
		});
	});
});

describe("salvo damage formula composition (bead rhij)", () => {
	test("'1d10+2': the dice and flat parts scale separately, per hit", () => {
		// The old `${through}${damage}` string-concat composed "21d10+2" for 2
		// hits — Foundry parses that as 21 d10 + 2 (~10x over-deal). The
		// composed string must keep dice and flat parts apart.
		expect(composeSalvoDamageFormula(1, "1d10+2")).toBe("1d10+2");
		expect(composeSalvoDamageFormula(2, "1d10+2")).toBe("2d10+4");
		expect(composeSalvoDamageFormula(3, "1d10+2")).toBe("3d10+6");
	});

	test("multi-dice formulas scale their dice count too", () => {
		expect(composeSalvoDamageFormula(2, "2d5+1")).toBe("4d5+2");
		expect(composeSalvoDamageFormula(3, "2d10+4")).toBe("6d10+12");
	});

	test("bare dice formulas stay bare", () => {
		expect(composeSalvoDamageFormula(4, "1d5")).toBe("4d5");
		expect(composeSalvoDamageFormula(2, "1d10")).toBe("2d10");
	});

	test("negative flat parts scale with a sign", () => {
		expect(composeSalvoDamageFormula(2, "1d10-1")).toBe("2d10-2");
	});

	test("a trailing damage-type suffix is stripped before composing", () => {
		expect(composeSalvoDamageFormula(2, "1d10+2 E")).toBe("2d10+4");
	});

	test("refuses formulas without a dice part", () => {
		expect(() => composeSalvoDamageFormula(2, "4")).toThrow(
			/composeSalvoDamageFormula/,
		);
		expect(() => composeSalvoDamageFormula(2, "")).toThrow(
			/composeSalvoDamageFormula/,
		);
	});

	test("refuses shapes it cannot compose soundly", () => {
		// Non-numeric flat part.
		expect(() => composeSalvoDamageFormula(2, "1d10+SB")).toThrow(
			/composeSalvoDamageFormula/,
		);
		// Two dice terms.
		expect(() => composeSalvoDamageFormula(2, "1d10+2d5")).toThrow(
			/composeSalvoDamageFormula/,
		);
		// Zero-sided dice / zero dice.
		expect(() => composeSalvoDamageFormula(2, "0d10+2")).toThrow(
			/composeSalvoDamageFormula/,
		);
		expect(() => composeSalvoDamageFormula(2, "1d0")).toThrow(
			/composeSalvoDamageFormula/,
		);
	});

	test("refuses non-positive hit counts", () => {
		expect(() => composeSalvoDamageFormula(0, "1d10+2")).toThrow(
			/hits must be a positive integer/,
		);
		expect(() => composeSalvoDamageFormula(-1, "1d10+2")).toThrow(
			/hits must be a positive integer/,
		);
	});
});

// Bead kxbz, registry per bead p6nx: the salvo gate — classification is
// data-driven through the kernel registry; only registered kinds fire a
// salvo; the ordnance types are Extended Actions (bead a413/S9).
describe("salvo weapon kind (bead kxbz, registry p6nx)", () => {
	test("accepts the two salvo componentTypes", () => {
		expect(salvoWeaponKind("macrobattery", "anything")).toBe("macrobattery");
		expect(salvoWeaponKind("lance", "anything")).toBe("lance");
	});

	test("refuses the ordnance componentTypes loudly (no guess)", () => {
		for (const type of ["torpedo-tube", "nova-cannon", "landing-bay"]) {
			expect(salvoWeaponKind(type, "name anything")).toBeNull();
		}
		// A torpedo tube named with a lance-looking name still refuses:
		// componentType is authoritative once set.
		expect(salvoWeaponKind("torpedo-tube", "Prow Torpedo Lance")).toBeNull();
	});

	test("blank componentType keeps the LEGACY name heuristic (fallback only)", () => {
		expect(salvoWeaponKind("", "Sunsear Laser Battery")).toBe("macrobattery");
		expect(salvoWeaponKind("", "Titanforge Lance")).toBe("lance");
	});

	// Bead p6nx: a present componentType wins over the legacy regex —
	// a macrobattery NAMED like a lance is classified by its data field.
	test("a present componentType wins over the legacy name regex", () => {
		expect(
			salvoWeaponKind("macrobattery", "Titanforge Lance"),
		).toBe("macrobattery");
		expect(
			salvoWeaponKind("lance", "Sunsear Laser Battery"),
		).toBe("lance");
	});
});

// Bead p6nx: the kernel ShipWeaponKindSpec registry — each registered kind
// carries its hit rate and armour rule with a Core Rulebook citation; a
// kind without citable book behaviour ships WITHOUT a spec (loud miss),
// never a guessed macrobattery.
describe("ship weapon kind registry (bead p6nx)", () => {
	test("both registered kinds carry a citation", () => {
		for (const kind of ["macrobattery", "lance"] as const) {
			const spec = shipWeaponKindSpec(kind);
			expect(spec.id).toBe(kind);
			expect(spec.citation).toContain("p220");
		}
	});

	test("macrobattery hit rate + Armour rule (book p220-221)", () => {
		const spec = shipWeaponKindSpec("macrobattery");
		expect(spec.hitsFor(0)).toBe(1);
		expect(spec.hitsFor(2)).toBe(3);
		expect(spec.ignoresArmour).toBe(false);
	});

	test("lance hit rate + Armour rule (book p220)", () => {
		const spec = shipWeaponKindSpec("lance");
		expect(spec.hitsFor(2)).toBe(1);
		expect(spec.hitsFor(3)).toBe(2);
		expect(spec.hitsFor(6)).toBe(3);
		expect(spec.ignoresArmour).toBe(true);
	});

	// The nova cannon / torpedo tube / landing bay behaviours are NOT in the
	// registry: their mechanics live in the Extended Action / BFK-ordnance
	// handlers (bead a413/S9), and no citable salvo resolution rule exists in
	// the repo-extracted data — so salvoWeaponKind misses loudly for them
	// (tested above) instead of a spec that would guess macrobattery values.
	test("no spec is registered for kinds without citable book behaviour", () => {
		const registered = Object.keys(SHIP_WEAPON_KINDS);
		expect(registered).toEqual(["macrobattery", "lance"]);
	});
});

// Bead oumh (epic necp): the COMBINED TEST (Core Rulebook p212) — "add the
// ship's ability, such as Manoeuvrability, to the character's Skill, such as
// Pilot (Space Craft)". Pure fold; the ship half also rides the roll funnel
// as a visible contributor row (id "ship:<ability>").
describe("combined target (book p212, bead oumh)", () => {
	test("folds the ship ability onto the character's skill target", () => {
		expect(combinedTarget(50, 30)).toBe(80); // Pilot 50 + Manoeuvrability +30
		expect(combinedTarget(31, 0)).toBe(31); // no ship ability → unchanged
		expect(combinedTarget(45, -10)).toBe(35); // negative ship-side delta still folds
	});
});
