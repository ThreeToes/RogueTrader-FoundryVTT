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
	| "come-to-new-heading-bs-penalty"
	// Put Your Backs Into It! (bead z697, Core Rulebook printed p218): the
	// +5 aid to a chosen Ballistic Skill (one weapon component) / Emergency
	// Repairs / fire-fighting action this turn; `target` carries the weapon
	// item id or the "emergency-repairs" / "firefighting" token.
	| "backs-into-it";

export const SHIP_TURN_FLAG_KEYS: readonly ShipTurnFlagKey[] = [
	"evasive",
	"lock-on-target",
	"aid-machine-spirit",
	"repel-boarders",
	"come-to-new-heading-bs-penalty",
	"backs-into-it",
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

// ---------------------------------------------------------------------------
// Turn-flag writes + the Focused Augury reveal ladder (Core Rulebook p217)
// ---------------------------------------------------------------------------

/**
 * INSERT/REPLACE a turn flag by KEY: a re-applied action (a second Aid the
 * Machine Spirit, Lock on Target, Prepare to Repel Boarders!) supersedes the
 * old entry rather than stacking a second read path onto the same key.
 */
export function replaceTurnFlag(
	flags: readonly ShipTurnFlag[],
	flag: ShipTurnFlag,
): ShipTurnFlag[] {
	return [...flags.filter((existing) => existing.key !== flag.key), flag];
}

/**
 * INSERT/REPLACE a turn flag by stable id (bead z697): several
 * Put Your Backs Into It! entries may coexist for DIFFERENT targets, so
 * re-rolling the action replaces only its own entry, never the others.
 */
export function upsertTurnFlag(
	flags: readonly ShipTurnFlag[],
	flag: ShipTurnFlag,
): ShipTurnFlag[] {
	return [...flags.filter((existing) => existing.id !== flag.id), flag];
}

/**
 * The component shapes the Focused Augury ladder reads (structural, so the
 * kernel test drives plain objects).
 */
export interface AugurComponentLike {
	type?: string;
	system?: { category?: string; componentType?: string };
}

/**
 * The machine weapon-component set (Core Rulebook pp200-203 + battlefleet
 * koronus additions, bead 5lbn): weapon systems the ship-weapon-component
 * item type and the weapon-ish componentType families cover.
 */
const WEAPON_COMPONENT_TYPES: ReadonlySet<string> = new Set([
	"macrobattery",
	"lance",
	"nova-cannon",
	"torpedo-tube",
	"landing-bay",
]);

/**
 * Focused Augury reveal ladder (Core Rulebook printed p217, the pack's
 * verbatim prose; CUMULATIVE — each degree includes the previous rungs):
 * - 0 degrees (Basic Success): all Essential Components EXCEPT Auger Arrays
 *   and Void Shields;
 * - 1 degree: all Weapon Components;
 * - 2 degrees: Auger Arrays, Void Shields and any combat related Components
 *   (under the machine taxonomy the combat Component list is already inside
 *   the earlier rungs — weapons reveal at 1°, the essential combat components
 *   such as the Bridge at 0° — so this rung adds augur/shield only);
 * - 3 degrees: ALL Components aboard the target ship.
 *
 * Returns true when the component is revealed at this degree of success.
 */
export function focusedAuguryReveal(
	component: AugurComponentLike,
	degrees: number,
): boolean {
	const degree = Math.min(3, Math.max(0, Math.floor(degrees)));
	const system = component.system ?? {};
	const componentType = system.componentType ?? "";
	const essential = (system.category ?? "") === "essential";
	const weapon =
		(component.type ?? "") === "ship-weapon-component" ||
		WEAPON_COMPONENT_TYPES.has(componentType);
	const augurOrShield =
		componentType === "augur-array" || componentType === "void-shield";
	if (weapon) return degree >= 1;
	if (augurOrShield) return degree >= 2;
	if (essential) return true;
	// Everything else (supplemental non-weapon, archeotech, xeno-tech): the
	// "All Components" rung.
	return degree >= 3;
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
		population: Math.max(
			0,
			Math.floor(start.population) - Math.floor(current.population),
		),
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

// ---------------------------------------------------------------------------
// Ramming + boarding turns (bead w98s, Core Rulebook p215)
// ---------------------------------------------------------------------------

/**
 * Ramming damage die by hull class (Core Rulebook p215): "doing damage
 * based on its hull size—1d5 for transports and raiders, 1d10 for frigates,
 * 2d5 for light cruisers, and 2d10 for cruisers". The table is keyed by the
 * starship `hullClass` TOKEN FAMILY, mirroring the
 * rules/ship-systems.ts HULL_CLASS_TOKENS precedent: grand cruisers and
 * battlecruisers are cruiser-family hulls (BFK Ch. II, epic decision 5) so
 * they roll the cruiser 2d10. An UNMAPPED hull class (a space station
 * ramming) returns null — the caller refuses LOUDLY, never silently infers.
 */
export const RAM_HULL_CLASS_DIE: Readonly<Record<string, string>> = {
	transport: "1d5",
	raider: "1d5",
	frigate: "1d10",
	"light cruiser": "2d5",
	cruiser: "2d10",
	// The cruiser family (rules/ship-systems.ts HULL_CLASS_TOKENS precedent).
	"grand-cruiser": "2d10",
	battlecruiser: "2d10",
};

/** The ramming damage die for a hull class; null = unmapped (refuse loudly). */
export function ramHullClassDie(hullClass: string): string | null {
	return RAM_HULL_CLASS_DIE[(hullClass ?? "").trim().toLowerCase()] ?? null;
}

/**
 * The pair state BOTH ships hold once the boarding lock lands (Core
 * Rulebook p215): each carries the OTHER ship's uuid, no failed-break-free
 * penalty yet.
 */
export function boardLockPairState(opponentUuid: string): ShipBoardingState {
	return { uuid: opponentUuid, breakFreeFailedThisTurn: false };
}

/** One side's statline the boarding opposed-Command rows read (p215 + p220). */
export interface BoardingTurnSide {
	crewPopulation: number;
	hullIntegrity: number;
	/** The ship's turret rating (p220: +10 per point to its side's Command). */
	turretRating: number;
	/** The side's own persistent Repel Boarders bonus (p218; 0 = not maintained). */
	repelBonus: number;
}

/**
 * The opposed-Command bonus rows for the ROLLING side of a boarding turn
 * (Core Rulebook p215): "+10 bonus ... for every full 10 points difference"
 * in Crew Population (the print's "Hull Integrity" sentence repeats the
 * Crew-Population wording, but the bead/epic book-map reads it as Hull
 * Integrity — the same +10-per-full-10 mechanism), the turret-rating bonus
 * BOTH directions (p220), and the Repel Boarders values (p218). The
 * truncation is toward zero on BOTH axes: a 15-point population gap is
 * "every full 10 points" = one step (+10), never two.
 */
export interface BoardingCommandBonus {
	/** Signed +10 per full 10 points of Crew Population difference. */
	population: number;
	/** Signed +10 per full 10 points of Hull Integrity difference. */
	hullIntegrity: number;
	/** +10 × the rolling side's own turret rating (Core Rulebook p220). */
	turret: number;
	/** The OPPONENT's turret rating works against the roller (−10 per point, p220). */
	opponentTurret: number;
	/** The rolling side's own repel-boarders bonus minus the opponent's. */
	repel: number;
	/** The signed total of the five rows. */
	total: number;
}

/** One full-10 step per axis, signed toward the larger side (Core Rulebook p215). */
function fullTenStep(rolling: number, opponent: number): number {
	const delta = rolling - opponent;
	const steps = Math.floor(Math.abs(delta) / 10);
	return steps === 0 ? 0 : Math.sign(delta) * steps * 10;
}

/** The five opposed-Command bonus rows for one boarding turn (see the type). */
export function boardingCommandBonus(
	rolling: BoardingTurnSide,
	opponent: BoardingTurnSide,
): BoardingCommandBonus {
	const population = fullTenStep(
		rolling.crewPopulation,
		opponent.crewPopulation,
	);
	const hullIntegrity = fullTenStep(
		rolling.hullIntegrity,
		opponent.hullIntegrity,
	);
	const turret = Math.max(0, rolling.turretRating) * 10;
	// `|| 0` normalises the -0 a 0-rating opponent would produce.
	const opponentTurret = -(Math.max(0, opponent.turretRating) * 10) || 0;
	const repel =
		Math.max(0, rolling.repelBonus) - Math.max(0, opponent.repelBonus);
	return {
		population,
		hullIntegrity,
		turret,
		opponentTurret,
		repel,
		total: population + hullIntegrity + turret + opponentTurret + repel,
	};
}

/**
 * The rout roll (Core Rulebook p215): the losing ship's crew "roll a d100
 * and compare it to their current Morale" — equal or lower keeps fighting;
 * HIGHER routes (surrender, or the explorers' grim choice).
 */
export function routRoll(roll: number, morale: number): { routed: boolean } {
	return { routed: roll > Math.max(0, morale) };
}
