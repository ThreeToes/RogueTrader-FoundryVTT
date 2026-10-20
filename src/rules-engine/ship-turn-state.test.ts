/**
 * Ship turn-state kernel unit tests (bead vph0, Core Rulebook Ch. VIII
 * pp215-218): expiry discipline, salvo turn-flag rows, the boarding lock
 * gate, break-free resolution and the one-turn crew-loss memory.
 */
import { describe, expect, it } from "bun:test";
import {
	activeTurnFlag,
	type BoardingTurnSide,
	boardingCommandBonus,
	boardLockPairState,
	breakFreePairState,
	expireTurnFlags,
	RAM_HULL_CLASS_DIE,
	ramHullClassDie,
	rotateLastTurnLosses,
	routRoll,
	SHIP_TURN_FLAG_KEYS,
	type ShipTurnFlag,
	salvoTurnFlagRows,
	shipIsBoarded,
	shipLockGate,
	sustainedCrewLosses,
} from "./ship-turn-state";

/** evasive −10, set during turn 3, cleared at the next own turn (index 4). */
const evasive = (overrides: Partial<ShipTurnFlag> = {}): ShipTurnFlag => ({
	id: "f1",
	key: "evasive",
	value: -10,
	target: "all",
	expiresAtTurn: null,
	persistent: false,
	...overrides,
});

describe("expiry discipline (bead vph0, decision 3)", () => {
	it("keeps flags until the flagged ship's next Strategic Turn", () => {
		const flags = [evasive({ expiresAtTurn: 4 })];
		// Still the firing turn (index 3): the flag holds.
		expect(expireTurnFlags(flags, 3)).toHaveLength(1);
		// Any earlier turn: holds.
		expect(expireTurnFlags(flags, 0)).toHaveLength(1);
		// Cleared EXACTLY at the own next turn (index 4).
		expect(expireTurnFlags(flags, 5)).toEqual([]);
		expect(expireTurnFlags(flags, 4)).toEqual([]);
	});

	it("clears a null-expiresAtTurn flag at the ship's own turn turnover", () => {
		const flags = [evasive()];
		expect(expireTurnFlags(flags, 3)).toEqual([]);
	});

	it("keeps persistent repel-boarders through every turnover (p218)", () => {
		const flags = [
			evasive({
				id: "f2",
				key: "repel-boarders",
				value: 10,
				expiresAtTurn: 4,
				persistent: true,
			}),
		];
		expect(expireTurnFlags(flags, 4)).toEqual(flags);
		expect(expireTurnFlags(flags, 99)).toEqual(flags);
	});

	it("drops only the expired entry in a mixed set", () => {
		const lock = evasive({
			id: "f3",
			key: "lock-on-target",
			value: 5,
			target: "sw1",
			expiresAtTurn: 5,
		});
		const flags = [evasive({ expiresAtTurn: 4 }), lock];
		expect(expireTurnFlags(flags, 4)).toEqual([lock]);
		expect(expireTurnFlags(flags, 5)).toEqual([]);
	});
});

describe("salvo turn-flag rows (bead vph0, pp215-217)", () => {
	const weaponId = "sw1";

	it("reads the firing ship's own evasive −10 (p215)", () => {
		const rows = salvoTurnFlagRows({
			firingFlags: [evasive({ value: -10 })],
			targetFlags: [],
			weaponId,
		});
		expect(rows).toEqual([{ side: "firing", key: "evasive", value: -10 }]);
	});

	it("reads the target ship's evasive −10 (p215)", () => {
		const rows = salvoTurnFlagRows({
			firingFlags: [],
			targetFlags: [evasive({ value: -10 })],
			weaponId,
		});
		expect(rows).toEqual([{ side: "target", key: "evasive", value: -10 }]);
	});

	it("gives Lock on Target's +5 ONLY to the named weapon (p217)", () => {
		const lock = evasive({
			id: "f3",
			key: "lock-on-target",
			value: 5,
			target: weaponId,
		});
		// The named component: +5.
		expect(
			salvoTurnFlagRows({ firingFlags: [lock], targetFlags: [], weaponId }),
		).toEqual([{ side: "firing", key: "lock-on-target", value: 5 }]);
		// Any other component: silence.
		expect(
			salvoTurnFlagRows({
				firingFlags: [lock],
				targetFlags: [],
				weaponId: "sw-other",
			}),
		).toEqual([]);
	});

	it("carries the Come to New Heading BS penalty on the ship's fire (p214)", () => {
		const rows = salvoTurnFlagRows({
			firingFlags: [
				evasive({ key: "come-to-new-heading-bs-penalty", value: -20 }),
			],
			targetFlags: [],
			weaponId,
		});
		expect(rows).toEqual([
			{ side: "firing", key: "come-to-new-heading-bs-penalty", value: -20 },
		]);
	});

	it("reads BOTH sides when both ships manoeuvred evasively", () => {
		const flag = evasive({ value: -10 });
		const rows = salvoTurnFlagRows({
			firingFlags: [flag],
			targetFlags: [flag],
			weaponId,
		});
		// −10 to own fire AND −10 to hit the target — two rows, both visible.
		expect(rows).toEqual([
			{ side: "firing", key: "evasive", value: -10 },
			{ side: "target", key: "evasive", value: -10 },
		]);
	});

	it("contributes no row for flags of other kinds", () => {
		expect(
			salvoTurnFlagRows({
				firingFlags: [evasive({ key: "repel-boarders", value: 10 })],
				targetFlags: [evasive({ key: "aid-machine-spirit", value: 5 })],
				weaponId,
			}),
		).toEqual([]);
	});

	it("activeTurnFlag scopes by weapon and matches 'all'", () => {
		const named = evasive({ key: "lock-on-target", target: weaponId });
		expect(activeTurnFlag([named], "lock-on-target", weaponId)).toBe(named);
		expect(activeTurnFlag([named], "lock-on-target", "other")).toBeNull();
		const all = evasive({ target: "all" });
		expect(activeTurnFlag([all], "evasive", weaponId)).toBe(all);
		// bead z697 added the backs-into-it key (Table 8-11 row).
		expect(SHIP_TURN_FLAG_KEYS.length).toBe(6);
	});
});

describe("boarding lock gate (bead vph0, p215)", () => {
	const boarded = { uuid: "Actor.ork", breakFreeFailedThisTurn: false };

	it("refuses manoeuvre and shooting on a boarded ship", () => {
		expect(shipLockGate(boarded, "manoeuvre")).toEqual({
			allowed: false,
			reason: "manoeuvre",
		});
		expect(shipLockGate(boarded, "shooting")).toEqual({
			allowed: false,
			reason: "shooting",
		});
	});

	it("still allows extended actions while boarded", () => {
		expect(shipLockGate(boarded, "extended")).toEqual({
			allowed: true,
			reason: "not-boarded",
		});
	});

	it("never gates an unboarded ship", () => {
		for (const action of ["manoeuvre", "shooting", "extended"] as const) {
			expect(shipLockGate(undefined, action).allowed).toBe(true);
			expect(shipLockGate({ uuid: "" }, action).allowed).toBe(true);
		}
	});

	it("shipIsBoarded requires a non-empty pair uuid", () => {
		expect(shipIsBoarded(boarded)).toBe(true);
		expect(shipIsBoarded({ uuid: "" })).toBe(false);
		expect(shipIsBoarded(undefined)).toBe(false);
	});

	it("break-free success clears the pair on both sides of the book", () => {
		const result = breakFreePairState(boarded, true);
		expect(result.pairCleared).toBe(true);
		expect(result.state.uuid).toBe("");
		expect(result.state.breakFreeFailedThisTurn).toBe(false);
		expect(result.commandPenalty).toBe(false);
	});

	it("break-free failure keeps the pair and sets the −20 Command penalty", () => {
		const result = breakFreePairState(boarded, false);
		expect(result.pairCleared).toBe(false);
		expect(result.state.uuid).toBe("Actor.ork");
		expect(result.state.breakFreeFailedThisTurn).toBe(true);
		expect(result.commandPenalty).toBe(true);
	});
});

describe("one-turn crew-loss memory (bead vph0, pp217-218)", () => {
	it("derives the losses sustained over the turn from the track values", () => {
		expect(
			sustainedCrewLosses(
				{ population: 90, morale: 80 },
				{ population: 88, morale: 80 },
			),
		).toEqual({ population: 2, morale: 0 });
		// Losses never go negative (gains over the turn are not credits).
		expect(
			sustainedCrewLosses(
				{ population: 50, morale: 50 },
				{ population: 60, morale: 70 },
			),
		).toEqual({ population: 0, morale: 0 });
	});

	it("keeps only the immediately previous turn's losses in the rotation", () => {
		// Older memory (2/1) is evicted; the latest turn's losses (7/5) land.
		const rotated = rotateLastTurnLosses(
			{ population: 2, morale: 1 },
			{ population: 7, morale: 5 },
		);
		expect(rotated).toEqual({ population: 7, morale: 5 });
		// And the older values are gone after the rewrite.
		expect(rotated.population).not.toBe(2);
	});
});

// ---------------------------------------------------------------------------
// bead z697 (epic necp S6): the turn-flag write helpers + the Focused Augury
// reveal ladder (Core Rulebook printed p217).
// ---------------------------------------------------------------------------

import {
	focusedAuguryReveal,
	replaceTurnFlag,
	upsertTurnFlag,
} from "./ship-turn-state";

describe("turn-flag writes (bead z697)", () => {
	it("replaceTurnFlag substitutes the KEY and keeps the other keys", () => {
		const flags = [
			evasive({ value: -10 }),
			evasive({ id: "aid", key: "aid-machine-spirit", value: 5 }),
		];
		const next = replaceTurnFlag(flags, evasive({ value: -5 }));
		expect(next).toHaveLength(2);
		expect(activeTurnFlag(next, "evasive")?.value).toBe(-5);
		expect(activeTurnFlag(next, "aid-machine-spirit")?.value).toBe(5);
	});

	it("upsertTurnFlag replaces only its OWN id — several targets coexist", () => {
		const first = evasive({
			key: "backs-into-it",
			id: "backs-into-it:w1",
			value: 5,
		});
		const second = evasive({
			key: "backs-into-it",
			id: "backs-into-it:emergency-repairs",
			value: 5,
		});
		const flags = [first, second];
		const next = upsertTurnFlag(
			flags,
			evasive({ key: "backs-into-it", id: "backs-into-it:w2", value: 5 }),
		);
		expect(next).toHaveLength(3);
		const reRoll = upsertTurnFlag(
			next,
			evasive({ key: "backs-into-it", id: "backs-into-it:w1", value: 10 }),
		);
		expect(reRoll).toHaveLength(3);
		expect(reRoll.find((f) => f.id === "backs-into-it:w1")?.value).toBe(10);
	});
});

describe("Focused Augury reveal ladder (bead z697, Core Rulebook p217)", () => {
	// The machine component shapes (category/componentType from the
	// ship-component schema; weapons are ship-weapon-component items or the
	// weapon-ish componentType families).
	const DRIVE = {
		system: { category: "essential", componentType: "plasma-drive" },
	};
	const BRIDGE = { system: { category: "essential", componentType: "bridge" } };
	const AUGER = {
		system: { category: "essential", componentType: "augur-array" },
	};
	const SHIELD = {
		system: { category: "essential", componentType: "void-shield" },
	};
	const WEAPON_ITEM = { type: "ship-weapon-component" } as const;
	const MACRO = {
		system: { category: "supplemental", componentType: "macrobattery" },
	};
	const TUBE = {
		system: { category: "supplemental", componentType: "torpedo-tube" },
	};
	const CARGO = {
		system: { category: "supplemental", componentType: "supplemental" },
	};
	const ARCHEO = {
		system: { category: "archeotech", componentType: "archeotech" },
	};

	it("0 degrees: essentials EXCEPT auger/shield; nothing else", () => {
		for (const component of [DRIVE, BRIDGE]) {
			expect(focusedAuguryReveal(component, 0)).toBe(true);
		}
		for (const component of [
			AUGER,
			SHIELD,
			WEAPON_ITEM,
			MACRO,
			TUBE,
			CARGO,
			ARCHEO,
		]) {
			expect(focusedAuguryReveal(component, 0)).toBe(false);
		}
	});

	it("1 degree: + all weapon components", () => {
		for (const component of [WEAPON_ITEM, MACRO, TUBE]) {
			expect(focusedAuguryReveal(component, 1)).toBe(true);
		}
		expect(focusedAuguryReveal(AUGER, 1)).toBe(false);
		expect(focusedAuguryReveal(SHIELD, 1)).toBe(false);
		expect(focusedAuguryReveal(CARGO, 1)).toBe(false);
	});

	it("2 degrees: + auger and shields", () => {
		expect(focusedAuguryReveal(AUGER, 2)).toBe(true);
		expect(focusedAuguryReveal(SHIELD, 2)).toBe(true);
		expect(focusedAuguryReveal(CARGO, 2)).toBe(false);
	});

	it("3 degrees (and beyond): everything", () => {
		for (const component of [
			DRIVE,
			BRIDGE,
			AUGER,
			SHIELD,
			WEAPON_ITEM,
			MACRO,
			TUBE,
			CARGO,
			ARCHEO,
		]) {
			expect(focusedAuguryReveal(component, 3)).toBe(true);
			expect(focusedAuguryReveal(component, 9)).toBe(true);
		}
	});

	it("negative degrees read as the basic success", () => {
		expect(focusedAuguryReveal(DRIVE, -1)).toBe(true);
		expect(focusedAuguryReveal(AUGER, -1)).toBe(false);
	});
});

// --- Ramming + boarding turns (bead w98s, Core Rulebook p215) -------------

describe("ramming hull-class die (bead w98s, p215)", () => {
	it("pins the vocabulary: exactly the cruiser-family + lesser hulls", () => {
		// Space stations (and any unmapped hull) have NO printed die — the
		// caller refuses.
		expect(Object.keys(RAM_HULL_CLASS_DIE).sort()).toEqual([
			"battlecruiser",
			"cruiser",
			"frigate",
			"grand-cruiser",
			"light cruiser",
			"raider",
			"transport",
		]);
	});

	it("maps the printed hull classes to their printed die (p215)", () => {
		expect(ramHullClassDie("transport")).toBe("1d5");
		expect(ramHullClassDie("raider")).toBe("1d5");
		expect(ramHullClassDie("frigate")).toBe("1d10");
		expect(ramHullClassDie("light cruiser")).toBe("2d5");
		expect(ramHullClassDie("cruiser")).toBe("2d10");
	});

	it("maps grand cruisers and battlecruisers through the cruiser family", () => {
		// The HULL_CLASS_TOKENS precedent (rules/ship-systems.ts): both are
		// cruiser-family hulls — the cruiser 2d10, never their own class.
		expect(ramHullClassDie("grand-cruiser")).toBe("2d10");
		expect(ramHullClassDie("battlecruiser")).toBe("2d10");
	});

	it("matches case-insensitively around whitespace", () => {
		expect(ramHullClassDie("Cruiser")).toBe("2d10");
		expect(ramHullClassDie(" Light Cruiser ")).toBe("2d5");
	});

	it("refuses an unmapped hull class (loudly, at the caller)", () => {
		expect(ramHullClassDie("space station")).toBeNull();
		expect(ramHullClassDie("")).toBeNull();
		expect(ramHullClassDie("ork rokk")).toBeNull();
	});
});

describe("boardLockPairState + routing plumbing (bead w98s)", () => {
	it("initialises the pair BOTH ships hold (book p215)", () => {
		expect(boardLockPairState("Actor.ork")).toEqual({
			uuid: "Actor.ork",
			breakFreeFailedThisTurn: false,
		});
	});
});

describe("boardingCommandBonus (bead w98s, Core Rulebook p215/p218/p220)", () => {
	const side = (
		overrides: Partial<BoardingTurnSide> = {},
	): BoardingTurnSide => ({
		crewPopulation: 100,
		hullIntegrity: 50,
		turretRating: 0,
		repelBonus: 0,
		...overrides,
	});

	it("pays +10 per FULL 10 points of population difference (both directions)", () => {
		// Bigger population: +10, +20...
		expect(
			boardingCommandBonus(
				side({ crewPopulation: 95 }),
				side({ crewPopulation: 91 }),
			).population,
		).toBe(0); // a 4-point gap is not a full 10
		expect(
			boardingCommandBonus(
				side({ crewPopulation: 100 }),
				side({ crewPopulation: 89 }),
			).population,
		).toBe(10); // an 11-point gap truncates to ONE full 10
		// ...and when the OPONENT is the bigger crew the row runs negative.
		expect(
			boardingCommandBonus(
				side({ crewPopulation: 69 }),
				side({ crewPopulation: 100 }),
			).population,
		).toBe(-30);
	});

	it("pays +10 per FULL 10 points of Hull Integrity difference (both directions)", () => {
		expect(
			boardingCommandBonus(
				side({ hullIntegrity: 50 }),
				side({ hullIntegrity: 50 }),
			).hullIntegrity,
		).toBe(0);
		expect(
			boardingCommandBonus(
				side({ hullIntegrity: 50 }),
				side({ hullIntegrity: 15 }),
			).hullIntegrity,
		).toBe(30);
		expect(
			boardingCommandBonus(
				side({ hullIntegrity: 4 }),
				side({ hullIntegrity: 50 }),
			).hullIntegrity,
		).toBe(-40);
	});

	it("truncates BOTH axes at once (the 10-point truncation gate)", () => {
		const bonus = boardingCommandBonus(
			side({ crewPopulation: 94, hullIntegrity: 47 }),
			side({ crewPopulation: 70, hullIntegrity: 8 }),
		);
		// Population gap 24 → TWO steps (+20); Hull gap 39 → THREE (+30).
		expect(bonus.population).toBe(20);
		expect(bonus.hullIntegrity).toBe(30);
	});

	it("counts the turret rating BOTH directions (+10 per point, p220)", () => {
		const bonus = boardingCommandBonus(
			side({ turretRating: 2 }),
			side({ turretRating: 1 }),
		);
		expect(bonus.turret).toBe(20);
		expect(bonus.opponentTurret).toBe(-10);
	});

	it("folds the Repel Boarders values both directions (p218)", () => {
		const bonus = boardingCommandBonus(
			side({ repelBonus: 10 }),
			side({ repelBonus: 10 }),
		);
		// Both sides maintain it: the row cancels.
		expect(bonus.repel).toBe(0);
		expect(boardingCommandBonus(side({ repelBonus: 10 }), side()).repel).toBe(
			10,
		);
		expect(boardingCommandBonus(side(), side({ repelBonus: 10 })).repel).toBe(
			-10,
		);
	});

	it("sums the five rows into the total", () => {
		const bonus = boardingCommandBonus(
			side({
				crewPopulation: 100,
				hullIntegrity: 50,
				turretRating: 1,
				repelBonus: 10,
			}),
			side({
				crewPopulation: 75,
				hullIntegrity: 50,
				turretRating: 0,
				repelBonus: 0,
			}),
		);
		expect(bonus.population).toBe(20);
		expect(bonus.hullIntegrity).toBe(0);
		expect(bonus.turret).toBe(10);
		expect(bonus.opponentTurret).toBe(0);
		expect(bonus.repel).toBe(10);
		expect(bonus.total).toBe(40);
	});
});

describe("routRoll (bead w98s, Core Rulebook p215)", () => {
	it("fights on when the roll is equal or lower than Morale", () => {
		expect(routRoll(50, 50).routed).toBe(false); // equal keeps fighting
		expect(routRoll(25, 50).routed).toBe(false);
	});

	it("routes when the roll EXCEEDS current Morale", () => {
		expect(routRoll(51, 50).routed).toBe(true);
		expect(routRoll(100, 99).routed).toBe(true);
	});

	it("matches the morale bands", () => {
		// Morale 100: nothing routes.
		expect(routRoll(100, 100).routed).toBe(false);
		// Morale 0: everything routes (any legal d100 exceeds it).
		expect(routRoll(1, 0).routed).toBe(true);
	});
});
