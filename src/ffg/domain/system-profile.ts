/**
 * Per-system rules profile for the kernel + creation/advancement/homebrew
 * maths (beads yszf + yojf, children of the multi-system epic hr6r).
 *
 * Everything that differs between FFG 40k systems must be expressed as
 * profile DATA, never as hardcoded constants inside the pure resolvers.
 * Sibling modules (DH2 starts at 1,000 xp, Only War at 600, etc.) supply
 * their own SystemProfile object and pass it to the resolvers; the pure
 * functions default to `rtCore` so existing RT callers need no changes.
 *
 * Lives in domain (not rules) because it is pure profile DATA that every
 * layer — infrastructure's config port included — must be able to import;
 * the architecture boundaries (epic kof0) forbid infrastructure -> rules.
 * Mirrors the pattern of src/rules-engine/src/profile.ts (RuleProfile /
 * rtCore) at the roguetrader layer.
 */

import {
	type RuleProfile,
	rtCore as rtCoreRuleProfile,
} from "../../rules-engine/src/index";

/**
 * Profile data for the pure creation/advancement/homebrew resolvers.
 *
 * COMPOSITION (bead yojf): this extends the rules-engine's RuleProfile, so
 * ONE object carries the kernel data (crit handling, hit locations,
 * characteristic vocabulary, wound/fate/psychic/critical-table extension
 * points) AND the creation/advancement constants. A sibling system builds a
 * single profile object and hands it to both the kernel resolvers and the
 * creation/advancement ones — there is no third competing profile type.
 */
export interface SystemProfile extends RuleProfile {
	/** Profile id, e.g. "rt-core". */
	id: string;
	/** Base characteristic value before allocation (RT Core Rulebook p14). */
	characteristicBase: number;
	/** Point-buy budget (RT Core Rulebook p14 "Allocating Points"). */
	pointBuyBudget: number;
	/** Per-characteristic point-buy cap (RT Core Rulebook p14). */
	pointBuyMax: number;
	/** The character creator's final step index (see rules/creation.ts). */
	creatorLastStep: number;
	/** xp considered already spent at character creation (RT Core Rulebook p13). */
	preSpentBaseline: number;
	/** Core fire-mode to-hit bonuses on attack tests (Core Rulebook p237). */
	fireModeBonus: { burst: number; full: number };
	/**
	 * Core Psychic Strength Push caps (Table 6-1, Core Rulebook p157):
	 * sanctioned +3, renegades/sorcerers +4.
	 */
	pushCap: { sanctioned: number; other: number };
}

/** Rogue Trader core profile — the current hardcoded values, as data. */
export const rtCore: SystemProfile = {
	...rtCoreRuleProfile,
	id: "rt-core",
	characteristicBase: 25,
	pointBuyBudget: 100,
	pointBuyMax: 20,
	creatorLastStep: 4,
	preSpentBaseline: 4500,
	fireModeBonus: { burst: 10, full: 20 },
	// As data: the values psychic.ts#pushCap() resolves (Table 6-1, p157) —
	// the profile must not depend on the rules layer.
	pushCap: { sanctioned: 3, other: 4 },
};

/** Default profile the pure resolvers fall back to when none is supplied. */
export const DEFAULT_SYSTEM_PROFILE: SystemProfile = rtCore;