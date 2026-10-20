/**
 * Ship Strategic Turn boundary adapter (bead 6ddz, Core Rulebook Ch. VIII
 * pp214-218): the document-write side of rules-engine/ship-turn-state.ts's
 * shipTurnStart — turn-flag expiry + lastTurnLosses rotation at the FLAGGED
 * ship's own Strategic Turn START (the kernel contract bead vph0 left
 * unwired: flags persisted forever and Triage/Hold Fast! always clamped to
 * nothing).
 *
 * v14.366 runtime seam verified against the installed foundry.mjs: Combat#
 * nextTurn/nextRound/startCombat all issue their update from a diff that
 * carries `round` and/or `turn` (updateData = {round, turn}), and the
 * document update machinery emits Hooks.callAll(`update${documentName}`, doc,
 * change, options, userId) with the changed payload — so "updateCombat"
 * fires exactly when a turn (or round) boundary is crossed. Combat#combatant
 * = turns[turn] (foundry.mjs get combatant()), whose `actor` is the same
 * combatant-actor shape the encounter-end cleanup reads (combat-end.ts
 * precedent).
 *
 * Only the currently-ACTIVE combatant's turn is maintained — that is the
 * ship whose Strategic Turn is starting; every other ship's maintenance
 * fires when the tracker advances to IT. Ships never entered into the
 * tracker get no turn boundary in v1 (documented on the bead).
 */

import {
	type ShipCrewLosses,
	type ShipTurnFlag,
	shipTurnStart,
} from "../../rules-engine/index";
import { systemOf } from "../data/accessors";
import { getPorts } from "../infrastructure/foundry/ports";

/** The starship-system fields the turn-start maintenance reads/writes. */
interface ShipTurnSystem {
	turnFlags?: ShipTurnFlag[];
	lastTurnLosses?: ShipCrewLosses;
	turnStartCrew?:
		| ShipCrewLosses
		| { population?: number | null; morale?: number | null }
		| null;
	crewPopulation?: number;
	crewMorale?: number;
}

/**
 * Normalise the turn-start snapshot to pure kernel shape (round-3 review,
 * bead wp6o): worlds that ran the pre-wp6o schema hold the truthy legacy
 * default object {population: null, morale: null} in their database — a
 * nullish-children object is NO snapshot (the kernel's !state.turnStartCrew
 * seeding branch would be skipped and a hand-seeded memory zeroed), so it
 * collapses to null the same as a missing key. The v14 runtime verified
 * (foundry.mjs): a nullable+initial-null SchemaField yields null on init,
 * but legacy stored objects persist and are normalised HERE; Math.floor of
 * a null child would otherwise read the snapshot as 0/0.
 */
function snapshotOrNull(
	snapshot: ShipTurnSystem["turnStartCrew"],
): ShipCrewLosses | null {
	if (!snapshot) return null;
	const { population, morale } = snapshot as {
		population?: number | null;
		morale?: number | null;
	};
	if (
		population === null ||
		population === undefined ||
		morale === null ||
		morale === undefined
	) {
		return null;
	}
	return { population, morale };
}

/** The current crew tracks (percentage points, clamped at zero). */
function currentCrew(system: ShipTurnSystem): ShipCrewLosses {
	return {
		population: Math.max(0, Math.floor(system.crewPopulation ?? 100)),
		morale: Math.max(0, Math.floor(system.crewMorale ?? 100)),
	};
}

/**
 * Run ONE ship's turn-START maintenance and write the rotated state back:
 * expired turn flags dropped, lastTurnLosses holds the turn now closing's
 * losses, the snapshot replants at the current tracks. A null snapshot is
 * the seeding call (no rotation — see shipTurnStart).
 */
export async function applyShipTurnStart(
	ship: unknown,
	turnIndex: number,
): Promise<void> {
	const ports = getPorts();
	const system = systemOf(ship as { system: unknown }) as ShipTurnSystem;
	const next = shipTurnStart(
		{
			turnFlags: system.turnFlags ?? [],
			lastTurnLosses: system.lastTurnLosses ?? { population: 0, morale: 0 },
			turnStartCrew: snapshotOrNull(system.turnStartCrew),
		},
		currentCrew(system),
		turnIndex,
	);
	await ports.actors.update(ship, {
		system: {
			turnFlags: next.turnFlags,
			lastTurnLosses: next.lastTurnLosses,
			turnStartCrew: next.turnStartCrew,
		},
	});
}

/**
 * The combat-tracker turn change, for the ship whose turn is STARTING:
 * combat.combatant is turns[turn] (foundry.mjs); the combat round is the
 * global turn index the torpedo-run flags' expiresAtTurn already counts in
 * (rules-engine/ship-ordnance.ts's torpedoRunExpiry keyed the launch off
 * ports.clock.round()). A non-starship active combatant (an explorer, a
 * vehicle) carries no turn flags — skipped.
 *
 * KNOWN SEAM (round-3 review nit, recorded not fixed): the turnIndex/round
 * passed on is read from the combat DOCUMENT THE HOOK RECEIVED, while the
 * torpedo-run flags' launchTurn was stamped from ports.clock.round() — the
 * VIEWED combat. With more than one combat open the two can be different
 * trackers, so flag expiry would count against the wrong round. v1 assumes
 * one live combat; revisit when multi-combat space play actually happens.
 */
export async function maintainActiveCombatant(combat: unknown): Promise<void> {
	const active = (combat as { combatant?: { actor?: unknown } | null } | null)
		?.combatant;
	const actor = active?.actor as { type?: string } | null | undefined;
	if (!actor || actor.type !== "starship") return;
	const round = Math.max(
		0,
		Math.floor(Number((combat as { round?: number }).round ?? 0)),
	);
	await applyShipTurnStart(actor, round);
}

/**
 * Register the updateCombat listener (adapter side). One executor: the hook
 * fires on every connected client, so only the local driving user writes —
 * the same guard the encounter-end cleanup uses (combat-end.ts).
 */
export function registerShipTurnBoundaryHook(): void {
	const hooks = (
		globalThis as {
			Hooks?: { on: (name: string, fn: (...args: unknown[]) => void) => void };
		}
	).Hooks;
	hooks?.on("updateCombat", (...args: unknown[]) => {
		const combat = args[0];
		const change = args[1];
		const userId = args[3] as string;
		// Only a boundary diff drives the maintenance: every other Combat
		// update (initiative rolls, flags) carries neither turn nor round.
		const diff = (change ?? {}) as { turn?: unknown; round?: unknown };
		if (diff.turn === undefined && diff.round === undefined) return;
		if (userId !== (game as { userId?: string }).userId) return;
		maintainActiveCombatant(combat).catch((error) =>
			console.error(
				"rogue-trader | ship Strategic Turn start maintenance failed",
				error,
			),
		);
	});
}
