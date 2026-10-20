/**
 * Ship-ordnance kernel maths (epic necp child S9, bead a413 — Battlefleet
 * Koronus printed pp6-16): the printed tables and test maths the ordnance
 * machinery rows consume, pinned spot-check style against the dump
 * (CACHED-battlefleet-koronus-layout.txt; the "6"/"7" footers under the
 * Torpedoes prose are the printed pages 6/7).
 */
import { describe, expect, it } from "bun:test";
import {
	BOMBER_RUN_CRIT_DEGREES,
	TORPEDO_GUIDANCES,
	TORPEDO_PROFILES,
	assaultBoatLandings,
	bomberRunCritical,
	bomberRunHits,
	squadronBonus,
	torpedoHitCap,
	torpedoHitDamage,
	torpedoRating,
	torpedoRunExpiry,
	torpedoRunSpent,
	torpedoRunTravelled,
	torpedoRunTurns,
	torpedoSalvoHits,
	torpedoSpeedRange,
	terminalPenetrationRerolls,
	turretShootDownHits,
	turretTestBonus,
	type ShipTorpedoSalvo,
} from "./index";

describe("Table 1-1: Torpedoes (Battlefleet Koronus printed p8)", () => {
	it("pins the printed columns (spot-check: all five warhead rows)", () => {
		expect(TORPEDO_PROFILES.plasma).toEqual({
			name: "plasma",
			speed: 10,
			damage: "2d10+14",
			critRating: 10,
			range: 60,
			terminalPenetration: 3,
		});
		expect(TORPEDO_PROFILES.boarding.damage).toBe("2d10+11");
		expect(TORPEDO_PROFILES.melta).toMatchObject({
			damage: "2d10+15",
			critRating: 9,
			terminalPenetration: 4,
		});
		expect(TORPEDO_PROFILES.virus).toMatchObject({
			damage: "2d10+10",
			terminalPenetration: 1,
			// The printed "–": no damage-dice critical.
			critRating: 0,
		});
		expect(TORPEDO_PROFILES.vortex).toMatchObject({
			damage: "2d10+5",
			critRating: 6,
			terminalPenetration: 5,
		});
	});
});

describe("guidance Torpedo Ratings (Battlefleet Koronus printed p9)", () => {
	it("pins the printed modifiers", () => {
		expect(TORPEDO_GUIDANCES.standard.torRating).toBe(20);
		expect(TORPEDO_GUIDANCES.guided.torRating).toBe(20);
		expect(TORPEDO_GUIDANCES.seeking.torRating).toBe(30);
		expect(TORPEDO_GUIDANCES["short-burn"]).toEqual({
			name: "short-burn",
			torRating: 15,
			speed: 15,
			range: 30,
		});
	});

	it("boarding torpedoes are ALWAYS Guided and refuse other guidance", () => {
		expect(torpedoRating("boarding", "seeking")).toBe(20);
		expect(torpedoRating("boarding", "standard")).toBe(20);
		// Other warheads honour the chosen guidance.
		expect(torpedoRating("plasma", "seeking")).toBe(30);
	});

	it("short-burn overrides speed and range (printed p9)", () => {
		expect(torpedoSpeedRange(TORPEDO_PROFILES.plasma, "short-burn")).toEqual({
			speed: 15,
			range: 30,
		});
		expect(torpedoSpeedRange(TORPEDO_PROFILES.plasma, "guided")).toEqual({
			speed: 10,
			range: 60,
		});
	});
});

describe("torpedo salvo attack (Battlefleet Koronus printed p7)", () => {
	it("1 torpedo + 1 per degree, capped by the salvo size", () => {
		expect(torpedoSalvoHits(0, 4, false)).toBe(1);
		expect(torpedoSalvoHits(3, 4, false)).toBe(4);
		expect(torpedoSalvoHits(6, 4, false)).toBe(4); // cap
		expect(torpedoSalvoHits(2, 0, false)).toBe(0);
	});

	it("a WIDE salvo caps at half the salvo size (printed p7)", () => {
		expect(torpedoHitCap(7, true)).toBe(3);
		expect(torpedoHitCap(6, true)).toBe(3);
		expect(torpedoHitCap(7, false)).toBe(7);
		expect(torpedoSalvoHits(4, 7, true)).toBe(3);
	});
});

describe("turret shoot-down (Battlefleet Koronus printed p13 + Core Rulebook p220)", () => {
	it("+5 per Turret Rating; Turret 0 cannot attempt", () => {
		expect(turretTestBonus(1)).toBe(5);
		expect(turretTestBonus(3)).toBe(15);
		expect(turretTestBonus(0)).toBe(0);
	});

	it("1 hit + 1 per TWO degrees", () => {
		expect(turretShootDownHits(0)).toBe(1);
		expect(turretShootDownHits(1)).toBe(1);
		expect(turretShootDownHits(2)).toBe(2);
		expect(turretShootDownHits(5)).toBe(3);
	});
});

describe("Terminal Penetration (X) (Battlefleet Koronus printed pp8-9)", () => {
	it("re-rolls every die ≤ X exactly once (indices only)", () => {
		// TP(X): dice EQUAL TO OR LOWER than X re-roll once (Melta TP(4):
		// "re-roll any dice results of 4 or lower", printed p8).
		expect(terminalPenetrationRerolls([10, 4, 3, 8], 3)).toEqual([2]);
		expect(terminalPenetrationRerolls([10, 4, 3, 8], 4)).toEqual([1, 2]);
		expect(terminalPenetrationRerolls([5, 5, 5], 5)).toEqual([0, 1, 2]);
		expect(terminalPenetrationRerolls([6, 7], 3)).toEqual([]);
		expect(terminalPenetrationRerolls([1, 2], 0)).toEqual([]);
	});
});

describe("per-torpedo damage (Battlefleet Koronus printed pp7-9)", () => {
	it("damage vs armour is per torpedo, never combined; crits by die value", () => {
		// Plasma: 2d10+14, armour 20 → a 3+4 roll (total 21) does 1.
		const hit = torpedoHitDamage([3, 4], 14, 20, 10);
		expect(hit.raw).toBe(21);
		expect(hit.hullDamage).toBe(1);
		// Crit Rating 10: one die of 10 crits.
		expect(torpedoHitDamage([10, 1], 14, 20, 10).critical).toBe(true);
		expect(torpedoHitDamage([9, 9], 14, 20, 10).critical).toBe(false);
		// No past-armour damage + a crit still does 1 point (printed p8).
		expect(torpedoHitDamage([10, 4], 14, 30, 10).hullDamage).toBe(1);
		// A crit rating of 0 (Boarding/Virus) never crits.
		expect(torpedoHitDamage([10, 10], 11, 10, 0).critical).toBe(false);
	});
});

describe("bombing run (Battlefleet Koronus printed p13)", () => {
	it("1 hit + 1 per degree, cap 3 + 1 per additional squadron", () => {
		expect(bomberRunHits(0, 1)).toBe(1);
		expect(bomberRunHits(5, 1)).toBe(3); // cap 3
		expect(bomberRunHits(5, 2)).toBe(4); // cap 3+1
		expect(bomberRunHits(9, 4)).toBe(6); // cap 3+3
	});

	it("≥ 4 degrees criticals; the squadron bonus is +5 per additional", () => {
		expect(bomberRunCritical(3)).toBe(false);
		expect(bomberRunCritical(4)).toBe(true);
		expect(BOMBER_RUN_CRIT_DEGREES).toBe(4);
		expect(squadronBonus(1)).toBe(0);
		expect(squadronBonus(4)).toBe(15);
	});
});

describe("assault-boat run (Battlefleet Koronus printed p13)", () => {
	it("1 landing + 1 per degree, capped by the surviving squadrons", () => {
		expect(assaultBoatLandings(0, 3)).toBe(1);
		expect(assaultBoatLandings(4, 3)).toBe(3);
		expect(assaultBoatLandings(4, 0)).toBe(0);
	});
});

describe("run timing (Battlefleet Koronus printed p7)", () => {
	it("Range/Speed turns; expiry at launchTurn + turns + 1", () => {
		expect(torpedoRunTurns(60, 10)).toBe(6);
		expect(torpedoRunExpiry(2, 60, 10)).toBe(9); // turns 3..8 move 6×10
		expect(torpedoRunExpiry(0, 30, 15)).toBe(3); // short-burn: 2 turns
	});

	it("travelled books Speed per subsequent turn, clamped to Range", () => {
		expect(torpedoRunTravelled(2, 2, 10, 60)).toBe(0);
		expect(torpedoRunTravelled(2, 4, 10, 60)).toBe(20);
		expect(torpedoRunTravelled(2, 9, 10, 60)).toBe(60);
		expect(torpedoRunTravelled(2, 30, 10, 60)).toBe(60);
	});

	it("a salvo is spent when out of torpedoes or past Range", () => {
		const base: ShipTorpedoSalvo = {
			id: "t",
			warhead: "plasma",
			name: "Plasma Torpedo",
			guidance: "standard",
			damage: "2d10+14",
			critRating: 10,
			terminalPenetration: 3,
			torRating: 20,
			speed: 10,
			range: 60,
			remaining: 2,
			travelled: 20,
			launchTurn: 1,
			wide: false,
			tubeId: "x",
		};
		expect(torpedoRunSpent(base)).toBe(false);
		expect(torpedoRunSpent({ ...base, remaining: 0 })).toBe(true);
		expect(torpedoRunSpent({ ...base, travelled: 60 })).toBe(true);
	});
});