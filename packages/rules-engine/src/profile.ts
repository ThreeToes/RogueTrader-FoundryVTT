/**
 * Per-game rule profiles.
 *
 * Everything that differs between FFG 40k systems (Dark Heresy 1&2, Rogue
 * Trader, Deathwatch, Black Crusade, Only War) must be expressed as profile
 * data, never as if/else inside resolvers. Adding DH2 or BC later means
 * adding a profile object, not code branches.
 *
 * NOTE: rtCore currently encodes remembered Rogue Trainer core rules; the
 * crit handling (doubles) is flagged for verification against the core book.
 */
export interface RuleProfile {
	/** Profile id, e.g. "rt-core". */
	id: string;
	/**
	 * A double (matching tens and units digits) occurred on the d100 roll.
	 * The kernel reports it as data; systems/profiles decide whether a double
	 * on success is a Critical Hit (RT core) or has other meaning.
	 */
	critOnDouble: boolean;
	/** Rolls at or above this value always fail (RT/DH1: 96+ when target < 96? core book check). */
	autoFailRoll: number | null;
	/** Rolls at or below this always succeed (DH1: 01-05 auto-pass). */
	autoPassRoll: number | null;
	/**
	 * Primitive armour rule: non-primitive weapons double wounds against
	 * primitive armour. (RT core; VERIFY book wording before shipping.)
	 */
	primitiveArmourDouble: boolean;
	/**
	 * Righteous Fury. The kernel flags triggering hits and the adapter resolves
	 * the extra damage die (Foundry-visible). (VERIFY trigger wording against
	 * the core book - remembered as "any hit that inflicts wounds".)
	 */
	righteousFury: { enabled: boolean; trigger: "damaging-hit" };
	/**
	 * Hit-location table: d100 TENS digit -> body location key. Keys follow
	 * the bodyLocations registry (kebab case). (Best-remembered RT core spread,
	 * VERIFY against the book.)
	 */
	hitLocations: Record<string, string>;
}

/** Rogue Trader core profile. */
export const rtCore: RuleProfile = {
	id: "rt-core",
	critOnDouble: true,
	autoFailRoll: null,
	autoPassRoll: null,
	primitiveArmourDouble: true,
	righteousFury: { enabled: true, trigger: "damaging-hit" },
	// tens digit of the to-hit roll -> body location (VERIFY against book)
	hitLocations: {
		"0": "left-leg",
		"1": "head",
		"2": "right-arm",
		"3": "right-arm",
		"4": "left-arm",
		"5": "left-arm",
		"6": "body",
		"7": "body",
		"8": "right-leg",
		"9": "right-leg",
	},
};
