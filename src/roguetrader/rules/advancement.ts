/**
 * Advancement engine (bead g7k): RT core Chapter II XP spending, PURE — no
 * Foundry coupling; dice/documents belong to the advancement dialog (clng).
 *
 * Book rules verified (rt_core p13/p38 + Table 2-2 p38):
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

/** xp considered already spent at character creation (rt_core p13). */
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
	// Prerequisites are raw book strings (structured parsing arrives with
	// tfk); they surface in the confirm dialog for GM adjudication.
	for (const prereq of row.prerequisites) {
		if (prereq) reasons.push(`Prerequisite to confirm with the GM: ${prereq}`);
	}
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