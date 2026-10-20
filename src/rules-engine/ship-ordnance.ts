/**
 * Ship ordnance kernel (epic necp child S9, bead a413 — Battlefleet Koronus
 * ch. I "The Weapons of War", printed pp6-16). Pure, Foundry-free,
 * data-in/data-out: the handler rolls dice and applies state, these functions
 * only derive. Mirrors ship-combat.ts's separation.
 *
 * The Core Rulebook defines NO torpedo/attack-craft rules ("What about
 * Torpedoes?" sidebar p219 sends them to later supplements); every rule below
 * cites Battlefleet Koronus (verified against
 * src/packs/.extraction-src/CACHED-battlefleet-koronus-layout.txt; the dump's
 * file footer N == printed page N: the "6"/"7" footers under the Torpedoes
 * text are the printed pages 6/7). Terminology: the Core Rulebook parts cite
 * as "Core Rulebook"; this book cites as "Battlefleet Koronus".
 *
 * Book-grounded rules (all Battlefleet Koronus printed pp6-16 unless noted):
 * - Table 1-1: Torpedoes (printed p8): Speed 10, Range 60 for ALL types;
 *   damage and Crit Rating differ per warhead; every warhead prints its
 *   Terminal Penetration (X); Boarding and Virus print "–" (no damage-dice
 *   critical).
 * - Torpedo Rating (printed p9): the Ballistic Skill to hit with torpedoes
 *   is "Ballistic Skill + Torpedo Rating" — +20 Standard Guidance, +20
 *   Guided, +30 Seeking, +15 Short-Burn; Boarding torpedoes are ALWAYS
 *   considered Guided and cannot accept further guidance.
 * - Launch/Run (printed pp6-7): the launcher's whole Strength is launched as
 *   a Salvo; NO attack roll at launch; a BS test is made when the salvo
 *   passes within 1 VU of a vessel — 1 torpedo + 1 per degree, capped by the
 *   salvo size; a WIDE salvo hits targets within 2 VUs at Hard (−20) with a
 *   half-salvo hit cap; torpedoes IGNORE void shields.
 * - Turrets (printed p13 "Defensive Turrets" + Core Rulebook p220): before
 *   the attacker rolls, the defender may attempt a Ballistic Skill test with
 *   the crew's Skill Rating, +5 per point of Turret Rating (Turret 1+
 *   required); 1 hit + 1 per TWO degrees, each shooting down ONE torpedo or
 *   attack-craft squadron from the wave.
 * - Bombing run (printed p13): Challenging (+0) Command + Craft Rating; 1
 *   hit + 1 per degree, cap 3 (+1 per additional bomber squadron); ≥4
 *   degrees = 1d5 on Table 8-12 (Core Rulebook p222); each hit 1d10+4,
 *   summed, minus the LOWEST armour value; void shields ignored.
 * - Fighter attack (printed p12): opposed Challenging (+0) Command + Craft
 *   Rating; 1 opposing squadron or torpedo eliminated per degree.
 * - Assault-boat run (printed p13): same Command + Craft Rating test; 1
 *   landing + 1 per degree, capped by the surviving squadrons; each landed
 *   squadron = one Hit and Run (Core Rulebook printed p218) ignoring the
 *   Pilot test, +10 per landed squadron.
 * - Terminal Penetration (X): re-roll any damage-die result ≤ X ONCE; the
 *   re-roll stands (printed pp8-9, per warhead).
 * - Crit Rating: when a torpedo's damage roll contains at least one die ≥
 *   the Crit Rating, it scores a Critical Hit; if it did no Hull damage it
 *   still does 1 point, then 1d5 on Table 8-12 (printed p7-8 "Torpedoes And
 *   Critical Hits").
 */

import type { ShipTurnFlag } from "./ship-turn-state";

// ---------------------------------------------------------------------------
// Table 1-1: Torpedoes (Battlefleet Koronus printed p8)
// ---------------------------------------------------------------------------

/** One torpedo warhead profile. */
export interface TorpedoProfile {
	/** Machine key matching the pack's ship-ordnance entries (`ordKey`). */
	name: string;
	/** Speed in VU per Strategic Turn (Table 1-1 Speed column). */
	speed: number;
	/** Per-hit damage formula — rolled ONCE PER HIT (printed p7). */
	damage: string;
	/** The damage-DIE value that scores a critical (0 = the printed "–"). */
	critRating: number;
	/** Total VUs before the reactor runs dry (Range column). */
	range: number;
	/** Terminal Penetration (X): damage dice ≤ X are re-rolled once (0 = none). */
	terminalPenetration: number;
}

/** The printed Table 1-1 rows; damage/crit/TP spot-checked against the dump. */
export const TORPEDO_PROFILES: Readonly<Record<string, TorpedoProfile>> = {
	plasma: {
		name: "plasma",
		speed: 10,
		damage: "2d10+14",
		critRating: 10,
		range: 60,
		terminalPenetration: 3,
	},
	boarding: {
		name: "boarding",
		speed: 10,
		damage: "2d10+11",
		// The printed "–": Boarding torpedoes score NO damage-dice critical —
		// a successful hit lands a Hit-and-Run attack instead (printed p8).
		critRating: 0,
		range: 60,
		terminalPenetration: 2,
	},
	melta: {
		name: "melta",
		speed: 10,
		damage: "2d10+15",
		critRating: 9,
		range: 60,
		terminalPenetration: 4,
	},
	virus: {
		name: "virus",
		speed: 10,
		damage: "2d10+10",
		critRating: 0,
		range: 60,
		terminalPenetration: 1,
	},
	vortex: {
		name: "vortex",
		speed: 10,
		damage: "2d10+5",
		critRating: 6,
		range: 60,
		terminalPenetration: 5,
	},
};

// ---------------------------------------------------------------------------
// Guidance systems (Battlefleet Koronus printed p9; Table 1-2 p9)
// ---------------------------------------------------------------------------

/** One guidance system's Torpedo Rating + movement overrides. */
export interface TorpedoGuidance {
	/** Machine key matching the pack's guidance entries (`ordKey`). */
	name: string;
	/** The guidance's Torpedo Rating contribution (printed p9 prose). */
	torRating: number;
	/** Short-Burn only: 15 VU/turn instead of 10 (printed p9). */
	speed?: number;
	/** Short-Burn only: range shortened to 30 VU (printed p9). */
	range?: number;
}

export const TORPEDO_GUIDANCES: Readonly<Record<string, TorpedoGuidance>> = {
	standard: { name: "standard", torRating: 20 },
	guided: { name: "guided", torRating: 20 },
	seeking: { name: "seeking", torRating: 30 },
	"short-burn": { name: "short-burn", torRating: 15, speed: 15, range: 30 },
};

/**
 * The Torpedo Rating for one guidance choice (printed p9). Boarding
 * torpedoes are ALWAYS considered Guided and accept no other guidance system
 * (printed p8) — their rating is the Guided 20 whatever the caller asked.
 */
export function torpedoRating(
	warhead: string,
	guidance: string,
): number {
	if ((warhead ?? "").trim().toLowerCase() === "boarding") return 20;
	const entry =
		TORPEDO_GUIDANCES[(guidance ?? "").trim().toLowerCase()] ??
		TORPEDO_GUIDANCES.standard;
	return entry.torRating;
}

/** The guidance's speed/range overrides onto one warhead profile (p9). */
export function torpedoSpeedRange(
	warhead: TorpedoProfile,
	guidance: string,
): { speed: number; range: number } {
	const entry =
		TORPEDO_GUIDANCES[(guidance ?? "").trim().toLowerCase()] ??
		TORPEDO_GUIDANCES.standard;
	return {
		speed: entry.speed ?? warhead.speed,
		range: entry.range ?? warhead.range,
	};
}

// ---------------------------------------------------------------------------
// Table 1-3: Common Attack Craft Ratings (Battlefleet Koronus printed p14)
// ---------------------------------------------------------------------------

/** One attack-craft type profile. */
export interface CraftProfile {
	/** Machine key matching the pack's ship-ordnance entries (`ordKey`). */
	name: string;
	/** Craft Rating (the +bonus to the Command + Craft Rating tests, p15). */
	craftRating: number;
	/** Speed in VU per Strategic Turn (squadrons move up to this, p12). */
	speed: number;
	/** Craft per full squadron (Table 1-3 guidelines, p14). */
	squadronSize: number;
	/**
	 * The printed second reading of a Multi-purpose craft (the parenthetical
	 * rating when used in its other role; Bloodflayer +8 (+4), Fighta-bomma
	 * +8 (+5), printed p14).
	 */
	altCraftRating: number | null;
	/**
	 * The printed Special-Rules token (Durable / Fragile / Master Pilots /
	 * Multi-purpose craft); narrative bookkeeping only — NO fake machinery,
	 * the bead's mandate (losses/Upkeep stay manual, printed pp16-11).
	 */
	special: string;
}

export const CRAFT_RATINGS: Readonly<Record<string, CraftProfile>> = {
	"fury-interceptor": {
		name: "fury-interceptor",
		craftRating: 10,
		speed: 10,
		squadronSize: 20,
		altCraftRating: null,
		special: "durable",
	},
	"starhawk-bomber": {
		name: "starhawk-bomber",
		craftRating: 0,
		speed: 6,
		squadronSize: 10,
		altCraftRating: null,
		special: "durable",
	},
	"shark-assault-boat": {
		name: "shark-assault-boat",
		craftRating: 5,
		speed: 10,
		squadronSize: 8,
		altCraftRating: null,
		special: "",
	},
	"swiftdeath-fighter": {
		name: "swiftdeath-fighter",
		craftRating: 10,
		speed: 11,
		squadronSize: 30,
		altCraftRating: null,
		special: "fragile",
	},
	"doomfire-bomber": {
		name: "doomfire-bomber",
		craftRating: 0,
		speed: 7,
		squadronSize: 15,
		altCraftRating: null,
		special: "fragile",
	},
	"dreadclaw-assault-boat": {
		name: "dreadclaw-assault-boat",
		craftRating: 5,
		speed: 11,
		squadronSize: 15,
		altCraftRating: null,
		special: "",
	},
	"darkstar-fighter": {
		name: "darkstar-fighter",
		craftRating: 15,
		speed: 12,
		squadronSize: 12,
		altCraftRating: null,
		special: "master-pilots",
	},
	"eagle-bomber": {
		name: "eagle-bomber",
		craftRating: 6,
		speed: 9,
		squadronSize: 6,
		altCraftRating: null,
		special: "master-pilots",
	},
	bloodflayer: {
		name: "bloodflayer",
		craftRating: 8,
		speed: 9,
		squadronSize: 15,
		altCraftRating: 4,
		special: "multi-purpose",
	},
	"fighta-bommers": {
		name: "fighta-bommers",
		craftRating: 8,
		speed: 8,
		squadronSize: 25,
		altCraftRating: 5,
		special: "multi-purpose",
	},
	// The generic "Assault Boats" row (Battlefleet Koronus Table 1-3 bottom).
	"assault-boat": {
		name: "assault-boat",
		craftRating: 8,
		speed: 10,
		squadronSize: 15,
		altCraftRating: null,
		special: "",
	},
};

// ---------------------------------------------------------------------------
// Salvo strike maths (Battlefleet Koronus printed pp6-9, 12-13)
// ---------------------------------------------------------------------------

/**
 * The hit CAP for one torpedo salvo attack (printed p7): the salvo's present
 * size; a WIDE salvo caps at half its current size ("decreases the chances
 * of multiple strikes").
 */
export function torpedoHitCap(remaining: number, wide: boolean): number {
	const size = Math.max(0, Math.floor(remaining));
	return wide ? Math.floor(size / 2) : size;
}

/** Torpedo hits (printed p7): 1 + 1 per degree, capped by the salvo. */
export function torpedoSalvoHits(
	degrees: number,
	remaining: number,
	wide: boolean,
): number {
	return Math.min(1 + Math.max(0, Math.floor(degrees)), torpedoHitCap(remaining, wide));
}

/**
 * Terminal Penetration (X) re-roll indices (printed pp8-9): any damage-die
 * result ≤ X is re-rolled ONCE — "the results of the re-roll stand". Returns
 * the INDEXES of the dice the caller must re-roll; dice strictly above X are
 * kept untouched.
 */
export function terminalPenetrationRerolls(
	dice: readonly number[],
	penetration: number,
): number[] {
	const pen = Math.max(0, Math.floor(penetration));
	if (pen === 0 || dice.length === 0) return [];
	return dice
		.map((value, index) => ({ value: Math.floor(value), index }))
		.filter((die) => die.value <= pen)
		.map((die) => die.index);
}

/** One torpedo hit's damage bookkeeping (printed pp7-8). */
export interface TorpedoHitOutcome {
	/** Damage past the target's Armour (≥0; 1 minimum when criticaling). */
	hullDamage: number;
	/** The raw roll (dice + printed bonus) — display data. */
	raw: number;
	/** True when a damage die met the Crit Rating (printed p7-8). */
	critical: boolean;
}

/**
 * One torpedo hit vs the target's Armour (printed pp7-8): damage per
 * torpedo that hit is compared to armour SEPARATELY ("the damage from
 * multiple torpedoes in a salvo is not combined"); a Critical Hit that does
 * no Hull damage still does 1 point of damage (printed p8).
 */
export function torpedoHitDamage(
	dice: readonly number[],
	damageBonus: number,
	armour: number,
	critRating: number,
): TorpedoHitOutcome {
	const raw =
		dice.reduce((sum, die) => sum + Math.max(0, Math.floor(die)), 0) +
		Math.max(0, damageBonus);
	const past = Math.max(0, raw - Math.max(0, armour));
	const critical =
		critRating > 0 && dice.some((die) => Math.floor(die) >= critRating);
	const hullDamage = past > 0 ? past : critical ? 1 : 0;
	return { raw, critical, hullDamage };
}

/** Turret fire (Battlefleet Koronus printed p13 + Core Rulebook p220). */
export const TURRET_BONUS_PER_RATING = 5;

/**
 * The turret test bonus: +5 per point of Turret Rating (printed p13); the
 * ship must have Turret Rating ≥ 1 to attempt at all. A 0-rating ship
 * contributes 0 (the attempt is refused, not merely weakened).
 */
export function turretTestBonus(turretRating: number): number {
	const rating = Math.max(0, Math.floor(turretRating));
	return rating >= 1 ? rating * TURRET_BONUS_PER_RATING : 0;
}

/** Turret shoot-down hits (printed p13): 1 + 1 per TWO degrees. */
export function turretShootDownHits(degrees: number): number {
	return 1 + Math.floor(Math.max(0, Math.floor(degrees)) / 2);
}

/** One attack-craft squadron's +5-per-extra-squadron bonus (printed pp12-13). */
export function squadronBonus(squadrons: number): number {
	return 5 * Math.max(0, Math.floor(squadrons) - 1);
}

/** Bombing-run damage per hit (printed p13). */
export const BOMBER_HIT_DIE = "1d10+4";
export const BOMBER_RUN_CRIT_DEGREES = 4;

/** Bombing-run hits (printed p13): cap 3 + 1 per additional squadron. */
export function bomberRunHits(degrees: number, squadrons: number): number {
	const cap = 3 + Math.max(0, Math.floor(squadrons) - 1);
	return Math.min(1 + Math.max(0, Math.floor(degrees)), cap);
}

/** The bombing run's Critical Hit trigger (printed p13): ≥ 4 degrees. */
export function bomberRunCritical(degrees: number): boolean {
	return Math.max(0, Math.floor(degrees)) >= BOMBER_RUN_CRIT_DEGREES;
}

/** Assault-boat landings (printed p13): 1 + degrees, capped by survivors. */
export function assaultBoatLandings(
	degrees: number,
	survivingSquadrons: number,
): number {
	return Math.min(
		1 + Math.max(0, Math.floor(degrees)),
		Math.max(0, Math.floor(survivingSquadrons)),
	);
}

// ---------------------------------------------------------------------------
// Run timing (printed p7) + the S2 turn-flag consumption
// ---------------------------------------------------------------------------

/** Strategic Turns a salvo travels before the reactors run dry (printed p7). */
export function torpedoRunTurns(range: number, speed: number): number {
	return Math.ceil(Math.max(0, range) / Math.max(1, speed));
}

/**
 * The machine expiry turn for the S2 turn-flag store: the salvo moves at the
 * START of each of the parent ship's subsequent Strategic Turns (launch on
 * turn L → moves on L+1 .. L+K, K = ceil(Range/Speed)); the K+1 turn's
 * expiry turnover clears the flag (expireTurnFlags drops at
 * turnIndex >= expiresAtTurn).
 */
export function torpedoRunExpiry(
	launchTurn: number,
	range: number,
	speed: number,
): number {
	return Math.max(0, Math.floor(launchTurn)) + torpedoRunTurns(range, speed) + 1;
}

/**
 * The distance a salvo has travelled by the CURRENT turn (printed p7: Speed
 * VU at the start of each subsequent Strategic Turn, the launch turn moves
 * nothing). Clamped so a resolution late in the run books at most Range.
 */
export function torpedoRunTravelled(
	launchTurn: number,
	currentTurn: number,
	speed: number,
	range: number,
): number {
	const turns = Math.max(0, Math.floor(currentTurn) - Math.max(0, Math.floor(launchTurn)));
	return Math.min(Math.max(0, range), turns * Math.max(1, speed));
}

/**
 * The active torpedo-salvo record the STARSHIP schema holds (a ship-side
 * sequence: launch, movement per turn, targets — bead a413 point 3). The
 * launch writes one entry + the matching "torpedo-run" turn flag (same id):
 * the flag carries the S2 expiry countdown; this record carries the salvo's
 * warhead numbers, which turn flags have no field for.
 */
export interface ShipTorpedoSalvo {
	/** Stable id; the matching turn flag carries the SAME id. */
	id: string;
	/** Warhead machine key (kernel TORPEDO_PROFILES / pack `ordKey`). */
	warhead: string;
	/** The torpedo item name as launched (display data). */
	name: string;
	/** Guidance choice machine key (TORPEDO_GUIDANCES). */
	guidance: string;
	/** The per-hit damage formula (the item's profile as launched). */
	damage: string;
	/** The damage-DIE critical threshold (0 = the printed "–"). */
	critRating: number;
	/** Terminal Penetration (X) (0 = none). */
	terminalPenetration: number;
	/** Torpedo Rating as launched (warhead + guidance, printed p9). */
	torRating: number;
	/** VU per Strategic Turn as launched. */
	speed: number;
	/** Total VUs before the reactors run dry. */
	range: number;
	/** Torpedoes remaining in the salvo. */
	remaining: number;
	/** VUs already booked by previous run resolutions. */
	travelled: number;
	/** The turn the salvo launched (clock round; runs move per turn). */
	launchTurn: number;
	/** WIDE salvo: 2 VU coverage, Hard (−20) BS, half-size hit cap (p7). */
	wide: boolean;
	/** The torpedo-tube component item id the salvo launched from. */
	tubeId: string;
}

/**
 * The run flag the launch writes into turnFlags (S2 kernel consumption, bead
 * a413 point 3): the flag's id IS the salvo id, the value carries the launch
 * salvo size, the expiry is the printed countdown, so S2's expireTurnFlags
 * turnover plus this kernel's own travelled check both gate the run.
 */
export function torpedoRunFlag(
	salvo: Pick<ShipTorpedoSalvo, "id" | "remaining" | "launchTurn" | "range" | "speed">,
): ShipTurnFlag {
	return {
		id: salvo.id,
		key: "torpedo-run",
		value: Math.max(0, Math.floor(salvo.remaining)),
		target: "all",
		expiresAtTurn: torpedoRunExpiry(salvo.launchTurn, salvo.range, salvo.speed),
		persistent: false,
	};
}

/** The salvo is over: out of torpedoes or past its Range (printed p6-7). */
export function torpedoRunSpent(salvo: ShipTorpedoSalvo): boolean {
	return (
		Math.max(0, Math.floor(salvo.remaining)) <= 0 ||
		Math.max(0, Math.floor(salvo.travelled)) >= Math.max(0, salvo.range)
	);
}