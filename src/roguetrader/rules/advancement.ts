/**
 * Advancement engine (bead g7k): RT core Chapter II XP spending, PURE — no
 * Foundry coupling; dice/documents belong to the advancement dialog (clng).
 *
 * Book rules verified (Core Rulebook p13/p38 + Table 2-2 p38):
 * - Characters begin with 4,500 xp already spent (PRE_SPENT_BASELINE) and
 *   500 xp to spend on Rank 1 advances; total spent starts at 4,500 and
 *   reaches 5,000 after the initial spending (p13).
 * - Rank = total spent xp (Table 2-2: Rank 1 5,000-6,999, Rank 2 7,000-
 *   9,999, ...). Ranks rise automatically once the threshold is crossed
 *   (p38 "Gaining Ranks"); splat books may add alternate ranks — the
 *   eligible set is data-driven from the career's ranks[].
 * - Advances may be bought from any Rank held or previously held, i.e.
 *   every rank <= derived rank (p38 "You may buy Advances from any Rank
 *   Advancement Scheme that you currently hold or have previously held").
 * - Characteristic Advances: +5 per purchase; progression levels Simple ->
 *   Intermediate -> Trained -> Expert, consumed in order, costs from the
 *   career's Characteristic Advance Scheme (p38, cumulative).
 * - Skill/Talent Advances use the static cost in the rank table row.
 * - Multiplier rows ("x2"/"x3") may be purchased multiple times at that
 *   rank, up to the multiplier (p39).
 * - Advances with prerequisites require the prereq to be met before
 *   purchase (p38); soft enforcement (GM overridable) mirrors tfk.
 * - Elite Advances are GM-granted, base cost 500 xp (p39).
 */

import type { CharacteristicKey } from "../data/actor/character";
import { evaluatePrerequisites, parsePrerequisites } from "./prereq";

/** xp considered already spent at character creation (Core Rulebook p13). */
export const PRE_SPENT_BASELINE = 4500;

export type AdvanceType = "skill" | "talent" | "characteristic";

/** One purchase recorded on the actor (the audit trail, g7k 1a). */
export interface AdvanceLedgerEntry {
	type: AdvanceType;
	/** Registry key when resolvable (skills/talents packs); "" otherwise. */
	key: string;
	/** Verbatim book name ("Performer (Choose One)"); resolvable rows use the pack name. */
	name: string;
	/** Characteristic key for type "characteristic". */
	characteristic?: CharacteristicKey;
	/** Cost paid. */
	cost: number;
	/** Career rank the advance belongs to (0 = creation baseline / elite). */
	rank: number;
	/** Characteristic progression tier (for characteristic purchases). */
	tier?: string;
	/** Career this advance came from (splat extensibility). */
	source?: string;
	/** Elite advance marker (GM-granted, p39). */
	elite?: boolean;
}

/** Minimal shape of a career rank's advance row (mirrors the Career schema). */
export interface AdvanceRowLike {
	key: string;
	name: string;
	type: "skill" | "talent";
	cost: number;
	multiplier: number;
	prerequisites: string[];
	rank: number;
}

/** Minimal shape of a career's rank threshold row. */
export interface RankThresholdLike {
	rank: number;
	xpLevel: number;
}

/** Minimal shape of the career's Characteristic Advance Scheme entry. */
export interface CharacteristicSchemeLike {
	simple: number;
	intermediate: number;
	trained: number;
	expert: number;
}

export type SchemeTier = "simple" | "intermediate" | "trained" | "expert";

export const SCHEME_TIERS: SchemeTier[] = [
	"simple",
	"intermediate",
	"trained",
	"expert",
];

// ---------------------------------------------------------------- Ledger math

/** Total xp spent = creation baseline + sum of ledger entries (p13). */
export function totalSpent(ledger: AdvanceLedgerEntry[]): number {
	return (
		PRE_SPENT_BASELINE + ledger.reduce((sum, entry) => sum + entry.cost, 0)
	);
}

/** Spent xp attributed to one career rank. */
export function spentOnRank(
	ledger: AdvanceLedgerEntry[],
	rank: number,
): number {
	return ledger
		.filter((entry) => entry.rank === rank)
		.reduce((sum, entry) => sum + entry.cost, 0);
}

/**
 * Eligible ranks: every rank whose xpLevel <= total spent (Table 2-2 +
 * p38 "Gaining Ranks": the Rank increases once the threshold is crossed).
 * Always includes rank 1 (characters hold it from creation, 4,500 baseline
 * spent covers its 5,000 threshold once the initial 500 are spent; before
 * that the character is still "rank 1" per the sheet's stored value).
 */
export function derivedRank(
	ranks: RankThresholdLike[],
	spent: number,
): number {
	let rank = 1;
	for (const threshold of ranks) {
		if (spent >= threshold.xpLevel && threshold.rank > rank) {
			rank = threshold.rank;
		}
	}
	return rank;
}

/** Next rank above `currentRank` and the xp still needed to reach it. */
export function rankProgress(
	ranks: RankThresholdLike[],
	spent: number,
): { nextRank: number | null; nextXpLevel: number | null; remaining: number } {
	const upcoming = ranks
		.filter((r) => r.xpLevel > spent)
		.sort((a, b) => a.xpLevel - b.xpLevel);
	const next = upcoming[0];
	if (!next) {
		return { nextRank: null, nextXpLevel: null, remaining: 0 };
	}
	return {
		nextRank: next.rank,
		nextXpLevel: next.xpLevel,
		remaining: next.xpLevel - spent,
	};
}

// ---------------------------------------------------------------- Availability

/**
 * Advance rows the character may buy: every rank held or previously held,
 * i.e. rank <= derived rank (p38). Rows of higher ranks are filtered out.
 */
export function availableRows(
	rows: AdvanceRowLike[],
	derived: number,
): AdvanceRowLike[] {
	return rows.filter((row) => row.rank <= derived);
}

/** How many purchases of a (key, rank) row remain against its multiplier. */
export function multiplierRemaining(
	row: AdvanceRowLike,
	ledger: AdvanceLedgerEntry[],
): number {
	const purchased = ledger.filter(
		(entry) =>
			entry.type === row.type &&
			entry.key === row.key &&
			entry.rank === row.rank,
	).length;
	return Math.max(0, row.multiplier - purchased);
}

// ---------------------------------------------------------------- Costs

/**
 * The next Characteristic Advance for a characteristic: tier consumed in
 * order from the career's scheme (p38). `purchased` = how many +5 advances
 * of this characteristic the ledger already records. Returns null at the
 * Expert tier is exhausted (or the scheme caps the tier at 0 cost, which
 * the packs use for "not available").
 */
export function characteristicNextAdvance(
	scheme: CharacteristicSchemeLike,
	purchased: number,
): { tier: SchemeTier; cost: number } | null {
	const tier = SCHEME_TIERS[purchased];
	if (!tier) return null;
	const cost = scheme[tier];
	// Scheme rows with cost 0 are "no advances available" in the packs.
	if (cost <= 0) return null;
	return { tier, cost };
}

// ---------------------------------------------------------------- Validation

export interface PurchaseValidation {
	ok: boolean;
	/** Soft-enforcement reasons shown in the confirm dialog (never silent). */
	reasons: string[];
}

/**
 * Validate a purchase against the book rules. SOFT enforcement: callers
 * present `reasons` in a confirm dialog the GM can overrule (design g7k 4).
 */
export function validatePurchase(
	row: AdvanceRowLike,
	context: {
		spent: number;
		pool: number;
		ledger: AdvanceLedgerEntry[];
		derivedRank: number;
	},
): PurchaseValidation {
	const reasons: string[] = [];
	if (row.rank > context.derivedRank) {
		reasons.push(`Rank ${row.rank} advance is beyond the character's current rank.`);
	}
	const remaining = multiplierRemaining(row, context.ledger);
	if (remaining <= 0) {
		reasons.push(
			`Multiplier limit reached: ${row.name} may only be purchased ${row.multiplier}x at this rank.`,
		);
	}
	if (row.cost > context.pool) {
		reasons.push(
			`Cost ${row.cost} xp exceeds the remaining pool of ${context.pool} xp.`,
		);
	}
	// Prerequisites are NOT handled here: bead tfk's structured evaluator
	// (rules/prereq.ts) owns them — the caller adds only UNMET prereqs to the
	// confirm reasons (previously this listed all raw strings; the evaluator
	// supersedes it).
	return { ok: reasons.length === 0, reasons };
}

/** The ledger entry a purchase produces. */
export function ledgerEntryFor(
	row: AdvanceRowLike,
	source?: string,
): AdvanceLedgerEntry {
	return {
		type: row.type,
		key: row.key,
		name: row.name,
		cost: row.cost,
		rank: row.rank,
		source,
	};
}

/**
 * Elite Advance base cost (p39): GM-granted, base 500 xp, adjustable.
 * Recorded in the ledger at rank 0 so rank math is unaffected.
 */
export const ELITE_ADVANCE_BASE_COST = 500;

export function eliteLedgerEntry(
	type: AdvanceType,
	name: string,
	cost = ELITE_ADVANCE_BASE_COST,
): AdvanceLedgerEntry {
	return {
		type,
		key: "",
		name,
		cost,
		rank: 0,
		elite: true,
	};
}

// ------------------------------------------------------- Alternate ranks

/**
 * The verbatim gates an alternate career rank prints (bead koau / g45s).
 * Kept as strings because the pack stores the book's own wording; the
 * evaluator below STRUCTURES them (career list, race, rank/xp, requirements)
 * at the edge, per this repo's "schema-first, book-notation at the edges" rule.
 */
export interface AlternateRankGate {
	requiredCareer: string;
	requiredRace: string;
	alternateRank: string;
	requirements: string;
	otherRequirements: string;
}

/** What the evaluator needs to know about the character. */
export interface AlternateGateContext {
	/** Primary career slug. */
	careerKey: string;
	/** Primary career display name (gates print names, not slugs). */
	careerName: string;
	/** Species key ("" = human), from the career's species block. */
	speciesKey: string;
	/** Species display label. */
	speciesLabel: string;
	/** Character's derived rank (Table 2-2). */
	rank: number;
	/** Total xp spent. */
	spent: number;
	characteristics: Partial<Record<CharacteristicKey, number>>;
	/** Owned talent names. */
	ownedTalents: string[];
	/** Owned skill names. */
	ownedSkills: string[];
	psyRating: number;
	/** Actor's psyker flag (Navigators count as psykers). */
	psyker: boolean;
}

export interface AlternateRankEvaluation {
	/** True when every HARD gate (career/race/rank/xp) is met. */
	eligible: boolean;
	/** Hard-gate failures — the rank is not offered. */
	reasons: string[];
	/** Soft notes (unmet requirements + verbatim Other Requirements prose). */
	notes: string[];
	/** Parsed rank/xp gates for display (0 = unspecified). */
	minRank: number;
	minXp: number;
}

/** Normalise a book name to comparable words. */
function normalizeGateName(value: string): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Loosely match a gate's printed name against a career/race name or slug:
 * exact after normalising, singular/plural tolerated ("Navigators" vs
 * "Navigator"), or the gate word is a whole word of the target ("Ork" vs
 * "Ork Freebooter").
 */
function gateNameMatches(gateName: string, candidate: string): boolean {
	const a = normalizeGateName(gateName);
	const b = normalizeGateName(candidate);
	if (!a || !b) return false;
	const singular = (value: string) => value.replace(/s$/, "");
	if (a === b || singular(a) === singular(b)) return true;
	const aWords = a.split(" ");
	const bWords = b.split(" ");
	return aWords.includes(b) || bWords.includes(a);
}

/** Split an "A, B, and C" / "A, B or C" gate list. */
function splitGateList(value: string): string[] {
	return value
		.replace(/\s+and\s+/gi, ",")
		.replace(/\s+or\s+/gi, ",")
		.split(",")
		.map((part) => part.trim().replace(/\.$/, ""))
		.filter(Boolean);
}

/**
 * Evaluate an alternate/elite rank's printed gates against a character
 * (bead g45s). HARD gates (unpermitted career/race, rank and xp below the
 * printed floor) decide `eligible`; the stat/skill Requirements and the prose
 * Other Requirements stay VISIBLE but soft — matching the advancement
 * dialog's GM-overridable convention (bead tfk). Pure and testable.
 */
export function evaluateAlternateRankGate(
	gate: AlternateRankGate,
	context: AlternateGateContext,
): AlternateRankEvaluation {
	const reasons: string[] = [];
	const notes: string[] = [];
	const required = (gate.requiredCareer ?? "").trim();
	const requiredRace = (gate.requiredRace ?? "").trim();

	if (requiredRace) {
		if (
			!gateNameMatches(requiredRace, context.speciesLabel) &&
			!gateNameMatches(requiredRace, context.speciesKey)
		) {
			reasons.push(`Requires Race: ${requiredRace}`);
		}
	}

	if (required) {
		const lower = required.toLowerCase();
		if (/^any\b/.test(lower)) {
			if (/\bhuman\b/.test(lower) && normalizeGateName(context.speciesKey) !== "") {
				reasons.push("Requires a human Explorer.");
			}
			if (
				/dark eldar/.test(lower) &&
				normalizeGateName(context.speciesKey) !== "dark eldar"
			) {
				reasons.push("Requires a Dark Eldar Explorer.");
			}
			if (/non-psyker/.test(lower) && context.psyker) {
				reasons.push("Requires a non-psyker Explorer.");
			}
			const exceptMatch = /except\s+(.*)$/i.exec(required);
			if (exceptMatch) {
				for (const token of splitGateList(exceptMatch[1]!)) {
					if (
						gateNameMatches(token, context.careerName) ||
						gateNameMatches(token, context.careerKey) ||
						gateNameMatches(token, context.speciesLabel) ||
						gateNameMatches(token, context.speciesKey)
					) {
						reasons.push(`Career not permitted: ${token}`);
					}
				}
			}
		} else {
			const allowed = splitGateList(required);
			if (
				!allowed.some(
					(name) =>
						gateNameMatches(name, context.careerName) ||
						gateNameMatches(name, context.careerKey),
				)
			) {
				reasons.push(`Requires Career: ${required}`);
			}
		}
	}

	const rankSpec = (gate.alternateRank ?? "").trim();
	const minRank = Number(/(\d+)/.exec(rankSpec)?.[1] ?? 0);
	const minXp = Number(
		(/([\d,]+)\s*xp/i.exec(rankSpec)?.[1] ?? "0").replace(/,/g, ""),
	);
	if (minRank > 0 && context.rank < minRank) {
		reasons.push(
			`Requires Rank ${minRank} (character is Rank ${context.rank}).`,
		);
	}
	if (minXp > 0 && context.spent < minXp) {
		reasons.push(
			`Requires ${minXp} xp spent (character has ${context.spent}).`,
		);
	}

	// Requirements/Prerequisites: structured by the shared evaluator (bead
	// tfk), but only as soft notes — a stat like "Pilot (Any One)" cannot be
	// resolved mechanically, and the dialog confirms before purchase anyway.
	if ((gate.requirements ?? "").trim()) {
		const stripLadder = (name: string) => name.replace(/\s*\+\d+\s*$/, "");
		// Ladder suffixes ride the requirement name ("Tech-Use +10"); strip them
		// from BOTH sides so an owned base skill satisfies the row.
		const requirementText = gate.requirements.replace(/\s*\+\d+\s*/g, " ");
		const { unmet } = evaluatePrerequisites(parsePrerequisites(requirementText), {
				characteristics: context.characteristics,
				talents: [...context.ownedTalents, ...context.ownedSkills].map(
					stripLadder,
				),
				psyRating: context.psyRating,
			},
		);
		for (const unmet_ of unmet) notes.push(`Requirement: ${unmet_}`);
	}

	if ((gate.otherRequirements ?? "").trim()) {
		notes.push(gate.otherRequirements.trim());
	}

	return {
		eligible: reasons.length === 0,
		reasons,
		notes,
		minRank,
		minXp,
	};
}