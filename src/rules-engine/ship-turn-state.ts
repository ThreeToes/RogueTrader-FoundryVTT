/**
 * Ship combat turn-state kernel (bead vph0, Core Rulebook Ch. VIII
 * pp215-218): pure, Foundry-free, data-in/data-out helpers over the
 * starship actor's combat turn state. Mirrors ship-combat.ts's separation:
 * these functions only derive; the adapters own the dice, the document
 * writes and the turn advancement (S1's ship-action handlers call
 * expireTurnFlags at the flagged ship's own Strategic Turn start).
 *
 * Rules grounded in the Core Rulebook:
 * - Turn flags expire at the FLAGGED ship's next Strategic Turn (decision 3);
 *   Prepare to Repel Boarders! is PERSISTENT — it lasts "until the acting
 *   character stops maintaining it" (p218) and is never auto-expired.
 * - Evasive Manoeuvres (p215): -10 to attacks made against the evading ship
 *   AND -10 to the evading ship's own fire — one flag, two read paths.
 * - Lock on Target (p217): +5 BS, and the bonus names the ONE weapon
 *   component it applies to; a salvo from any other weapon sees nothing.
 * - Come to New Heading (p214): -20 BS on the ship's fire that turn.
 * - Boarding lock (p215): "neither of them can take Manoeuvre or Shooting
 *   Actions" — extended actions are still allowed. A failed break-free
 *   attempt costs -20 on the subsequent opposed Command test (p215).
 * - Silent Running (p218): firing immediately reveals the ship.
 * - lastTurnLosses (pp217-218): one-turn memory of the PREVIOUS turn's crew
 *   losses, rewritten at the start of the ship's Strategic Turn; consumed by
 *   Triage (population) and Hold Fast! (morale).
 */

/** Keys of the turn-scoped flags the starship schema holds (bead vph0). */
export type ShipTurnFlagKey =
	| "evasive"
	| "lock-on-target"
	| "aid-machine-spirit"
	| "repel-boarders"
	| "come-to-new-heading-bs-penalty";

export const SHIP_TURN_FLAG_KEYS: readonly ShipTurnFlagKey[] = [
	"evasive",
	"lock-on-target",
	"aid-machine-spirit",
	"repel-boarders",
	"come-to-new-heading-bs-penalty",
];

/** The `"all"` target marker: the flag applies to every weapon/side. */
export const SHIP_TURN_FLAG_TARGET_ALL = "all";

/**
 * A turn-scoped modifier entry the salvo/manoeuvre pipelines read as a
 * visible row (decision 3: silent modifiers are bugs).
 */
export interface ShipTurnFlag {
	/** Stable id for re-set/clear operations. */
	id: string;
	key: ShipTurnFlagKey;
	/** Signed BS/Command modifier the flag carries (e.g. evasive -10). */
	value: number;
	/** The named weapon component item id, or `"all"`. */
	target: string;
	/**
	 * Turn index at which the flag is removed. `null` means it is cleared at
	 * the flagged ship's next Strategic Turn by turn turnover (no recorded
	 * index — the first expireTurnFlags call at the ship's own turn removes
	 * it).
	 */
	expiresAtTurn: number | null;
	/**
	 * PERSISTENT flag (Core Rulebook p218, Prepare to Repel Boarders!):
	 * never auto-expired — cleared only when the acting character stops
	 * maintaining it.
	 */
	persistent: boolean;
}

/**
 * Expiry discipline (decision 3): flag expiry at the flagged ship's next
 * Strategic Turn. Called at the ship's own turn START with the ship's turn
 * index; returns the surviving flags for the single `turnFlags` write.
 *
 * - Persistent flags (repel-boarders) always survive.
 * - A flag with expiresAtTurn `null` is cleared at the ship's next own turn
 *   — i.e. by THIS call.
 * - A recorded index is honoured EXACTLY: the flag survives while
 *   turnIndex < expiresAtTurn and is dropped when turnIndex >= expiresAtTurn
 *   (a flag set during turn N expires at the turnover to turn N+1).
 */
export function expireTurnFlags(
	flags: readonly ShipTurnFlag[],
	turnIndex: number,
): ShipTurnFlag[] {
	const index = Math.floor(turnIndex);
	return flags.filter((flag) => {
		if (flag.persistent) return true;
		if (flag.expiresAtTurn === null) return false;
		return index < Math.floor(flag.expiresAtTurn);
	});
}

/**
 * The active flag entry for `key`, with the target scoping applied: a flag
 * naming a weapon component only matches a salvo from THAT component; `"all"`
 * matches anything. Returns null when no such flag is present.
 */
export function activeTurnFlag(
	flags: readonly ShipTurnFlag[],
	key: ShipTurnFlagKey,
	weaponId?: string,
): ShipTurnFlag | null {
	return (
		flags.find((flag) => {
			if (flag.key !== key) return false;
			if (
				weaponId !== undefined &&
				flag.target !== SHIP_TURN_FLAG_TARGET_ALL &&
				flag.target !== weaponId
			) {
				return false;
			}
			return true;
		}) ?? null
	);
}

/** Which side of a salvo a flag row modifies. */
export type ShipTurnFlagRowSide = "firing" | "target";

/** A modifier row the salvo pipeline derives from turn flags (bead vph0). */
export interface ShipTurnFlagRow {
	side: ShipTurnFlagRowSide;
	key: ShipTurnFlagKey;
	/** Signed modifier value (the flag carries its own value). */
	value: number;
}

/**
 * The turn-flag modifier rows a salvo reads (Core Rulebook pp214-218,
 * decision 3: BOTH sides read):
 * - firing ship's Evasive Manoeuvres: -10 to its OWN fire (p215);
 * - firing ship's Come to New Heading: the -20 BS penalty on its fire that
 *   turn (p214);
 * - firing ship's Lock on Target: +5, only when the flag names THE weapon
 *   component being fired (p217);
 * - target ship's Evasive Manoeuvres: -10 to land the shot (p215).
 *
 * The values come from the flags themselves, so house-rule overrides stay
 * data-driven; an absent flag contributes no row.
 */
export function salvoTurnFlagRows(params: {
	firingFlags: readonly ShipTurnFlag[];
	targetFlags: readonly ShipTurnFlag[];
	weaponId: string;
}): ShipTurnFlagRow[] {
	const rows: ShipTurnFlagRow[] = [];
	const firingEvasive = activeTurnFlag(params.firingFlags, "evasive");
	if (firingEvasive) {
		rows.push({ side: "firing", key: "evasive", value: firingEvasive.value });
	}
	const heading = activeTurnFlag(
		params.firingFlags,
		"come-to-new-heading-bs-penalty",
	);
	if (heading) {
		rows.push({
			side: "firing",
			key: "come-to-new-heading-bs-penalty",
			value: heading.value,
		});
	}
	const lock = activeTurnFlag(
		params.firingFlags,
		"lock-on-target",
		params.weaponId,
	);
	if (lock) {
		rows.push({
			side: "firing",
			key: "lock-on-target",
			value: lock.value,
		});
	}
	const targetEvasive = activeTurnFlag(params.targetFlags, "evasive");
	if (targetEvasive) {
		rows.push({ side: "target", key: "evasive", value: targetEvasive.value });
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Boarding pair + lock gate (Core Rulebook p215)
// ---------------------------------------------------------------------------

/** Boarding-pair state: BOTH sides of a boarding hold the same pair. */
export interface ShipBoardingState {
	/** UUID of the paired ship; empty = not boarded. */
	uuid: string;
	/**
	 * The attempted break-free THIS turn failed — the -20 on the subsequent
	 * opposed Command test (Core Rulebook p215).
	 */
	breakFreeFailedThisTurn: boolean;
}

/** A ship is boarded (locked) while it holds a pair with a live opponent. */
export function shipIsBoarded(
	state: Partial<ShipBoardingState> | undefined,
): boolean {
	return typeof state?.uuid === "string" && state.uuid !== "";
}

/** Action classes the lock gate distinguishes (Core Rulebook p215). */
export type ShipLockAction = "manoeuvre" | "shooting" | "extended";

/**
 * Lock gate (Core Rulebook p215: "neither of them can take Manoeuvre or
 * Shooting Actions" while boarded): manoeuvre and shooting are REFUSED on
 * both boarded ships; extended actions are still allowed. The ship-action
 * handlers (S1/S5) call this with their action class before preparing.
 */
export function shipLockGate(
	state: Partial<ShipBoardingState> | undefined,
	action: ShipLockAction,
): { allowed: boolean; reason: "not-boarded" | "manoeuvre" | "shooting" } {
	if (!shipIsBoarded(state) || action === "extended") {
		return { allowed: true, reason: "not-boarded" };
	}
	return {
		allowed: false,
		reason: action === "manoeuvre" ? "manoeuvre" : "shooting",
	};
}

/**
 * Break-free attempt resolution (Core Rulebook p215): success clears the
 * pair (both ships free) and resets the failed-attempt penalty; failure
 * keeps the pair locked AND sets the -20 penalty on the subsequent opposed
 * Command test (the failed-break-free flag on the pair state).
 */
export function breakFreePairState(
	state: Partial<ShipBoardingState> | undefined,
	success: boolean,
): {
	pairCleared: boolean;
	state: ShipBoardingState;
	/** -20 on the subsequent opposed Command test (Core Rulebook p215). */
	commandPenalty: boolean;
} {
	if (success) {
		return {
			pairCleared: true,
			state: { uuid: "", breakFreeFailedThisTurn: false },
			commandPenalty: false,
		};
	}
	const keep = state?.uuid ?? "";
	return {
		pairCleared: false,
		state: { uuid: keep, breakFreeFailedThisTurn: true },
		commandPenalty: true,
	};
}

// ---------------------------------------------------------------------------
// One-turn crew-loss memory (Core Rulebook pp217-218)
// ---------------------------------------------------------------------------

/** Crew losses over one Strategic Turn (percentage-track points). */
export interface ShipCrewLosses {
	population: number;
	morale: number;
}

/**
 * Losses sustained over the turn, from the crew-track values at the turn's
 * START vs their values now (clamped at the track floor).
 */
export function sustainedCrewLosses(
	start: ShipCrewLosses,
	current: ShipCrewLosses,
): ShipCrewLosses {
	return {
		population: Math.max(0, Math.floor(start.population) - Math.floor(current.population)),
		morale: Math.max(0, Math.floor(start.morale) - Math.floor(current.morale)),
	};
}

/**
 * Rotation of the one-turn memory (Core Rulebook pp217-218): at the start of
 * the ship's Strategic Turn lastTurnLosses is REWRITTEN — last turn's values
 * in, older values out. Triage (population) and Hold Fast! (morale) consume
 * the returned previous-turn losses only (S6).
 */
export function rotateLastTurnLosses(
	previous: ShipCrewLosses,
	latest: ShipCrewLosses,
): ShipCrewLosses {
	return {
		population: Math.max(0, Math.floor(latest.population)),
		morale: Math.max(0, Math.floor(latest.morale)),
	};
}