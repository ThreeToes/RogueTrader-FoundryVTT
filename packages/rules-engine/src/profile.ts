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
}

/** Rogue Trader core profile. */
export const rtCore: RuleProfile = {
	id: "rt-core",
	critOnDouble: true,
	autoFailRoll: null,
	autoPassRoll: null,
};
