/**
 * Ship turn-state kernel unit tests (bead vph0, Core Rulebook Ch. VIII
 * pp215-218): expiry discipline, salvo turn-flag rows, the boarding lock
 * gate, break-free resolution and the one-turn crew-loss memory.
 */
import { describe, expect, it } from "bun:test";
import {
	activeTurnFlag,
	breakFreePairState,
	expireTurnFlags,
	rotateLastTurnLosses,
	salvoTurnFlagRows,
	shipIsBoarded,
	shipLockGate,
	sustainedCrewLosses,
	SHIP_TURN_FLAG_KEYS,
	type ShipTurnFlag,
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
		expect(rows).toEqual([
			{ side: "firing", key: "evasive", value: -10 },
		]);
	});

	it("reads the target ship's evasive −10 (p215)", () => {
		const rows = salvoTurnFlagRows({
			firingFlags: [],
			targetFlags: [evasive({ value: -10 })],
			weaponId,
		});
		expect(rows).toEqual([
			{ side: "target", key: "evasive", value: -10 },
		]);
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
			firingFlags: [evasive({ key: "come-to-new-heading-bs-penalty", value: -20 })],
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
		expect(SHIP_TURN_FLAG_KEYS.length).toBe(5);
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
			sustainedCrewLosses({ population: 90, morale: 80 }, { population: 88, morale: 80 }),
		).toEqual({ population: 2, morale: 0 });
		// Losses never go negative (gains over the turn are not credits).
		expect(
			sustainedCrewLosses({ population: 50, morale: 50 }, { population: 60, morale: 70 }),
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