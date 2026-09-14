/**
 * Casting-mode resolver (epic 0hap): how a psychic power is manifested — as a
 * psyker (Focus Power Test on the power's own characteristic, Psy Rating from
 * the actor's rating) or as a sorcerer (Edge of the Abyss pp85-87: Focus Power
 * Test becomes Intelligence, Psy Rating from the unmodified Intelligence
 * Bonus, a mandatory ritual, and the Corruption total added to Phenomena
 * rolls).
 *
 * The pack data keeps the BOOK's psyker-side notation (focusTest "Opposed
 * Willpower", etc.); this resolver applies the sorcery substitution at the
 * pipeline edge so one power serves both modes. Pure + Foundry-free; the
 * adapter (rules/roll-system.ts) consumes it.
 *
 * Rounding of "half his unmodified Intelligence Bonus" (EA p85) is pending
 * owner confirmation (bead k0um); ceil matches the Core Rulebook's
 * Fettered-Psy-Rating convention and is the current implementation.
 */

/** Whether a power is cast with the psyker or the sorcery rules. */
export type CastingMode = "psychic" | "sorcery";

/** Sorcery rank keys (registry: sorceryRanks). Blank = not a sorcerer. */
export type SorceryRank = "" | "sorcerer" | "master-sorcerer";

/** Sorcery Psy Rating factor by rank (EA pp85-86): half, then full. */
const SORCERY_RATING_FACTOR: Readonly<Record<string, number>> = {
	sorcerer: 0.5,
	"master-sorcerer": 1,
};

export interface CastingPowerLike {
	/** Owned-copy override ("" inherits the actor's casting mode). */
	castAs?: string;
	/** The book's Focus Power Test for the psyker mode (free text). */
	focusTest?: string;
	/** Focus Time; Free Action powers cannot be learned through Sorcery. */
	focusTime?: string;
}

export interface CastingActorLike {
	psyker?: boolean;
	psyRating?: number;
	sorceryRank?: string;
	sanctioned?: boolean;
	corruption?: number;
	/** Unmodified Intelligence Bonus (no Unnatural multiplier, EA p85). */
	intelligenceBonus?: number;
}

export interface CastingContext {
	mode: CastingMode;
	/** Base Psy Rating fed to effectivePsyRating (sorcery: Int Bonus). */
	rating: number;
	/** Focus Power characteristic override; "" = use the power's focusTest. */
	testKeyOverride: string;
	/** Table 6-1 row: sanctioned (push +3) vs renegade/sorcerer (push +4). */
	sanctioned: boolean;
	/** Flat modifier added FIRST to every Phenomena/Perils roll this actor makes. */
	phenomenaFlat: number;
	/** Sorcerous powers require a ritual gesture (EA p86). */
	ritualRequired: boolean;
}

/**
 * Sorcery Psy Rating from the unmodified Intelligence Bonus (EA pp85-86):
 * half for the Sorcerer talent, full for Master Sorcerer. No Unnatural
 * Intelligence. Rounding for an odd bonus is VERIFY (bead k0um) — ceil is
 * the current choice, matching the Fettered-Psy-Rating convention.
 */
export function sorceryPsyRating(
	rank: string | undefined,
	intelligenceBonus: number,
): number {
	const factor = SORCERY_RATING_FACTOR[rank ?? ""] ?? 0;
	if (factor <= 0) return 0;
	const bonus = Math.max(0, Math.floor(intelligenceBonus));
	return Math.ceil(bonus * factor);
}

/**
 * Whether a power's Focus Time is learnable through a Sorcery Talent
 * (EA p86): "Psychic Powers that have a Focus Time of a Free Action cannot
 * be learned through Sorcery Talents."
 */
export function sorceryLearnable(focusTime: string | undefined): boolean {
	return !/free\s*action/i.test(focusTime ?? "");
}

/** Whether the actor holds any sorcery rank. */
export function isSorcerer(actor: CastingActorLike): boolean {
	return (actor.sorceryRank ?? "") !== "";
}

/**
 * Resolve the actor's sorcery rank from its two sources (epic 0hap): the
 * owned Sorcery talents' numeric rank (0/1/2) wins, the manual
 * `sorceryRank` field is the GM/homebrew fallback. Pure.
 */
export function effectiveSorceryRank(
	talentRank: number,
	manual: string | undefined,
): SorceryRank {
	if (talentRank >= 2) return "master-sorcerer";
	if (talentRank >= 1) return "sorcerer";
	return manual === "sorcerer" || manual === "master-sorcerer" ? manual : "";
}

/**
 * Resolve how a power is cast. The owned copy's `castAs` wins; otherwise a
 * non-psyker with a sorcery rank defaults to sorcery, and everyone else to
 * psychic. A psyker+sorcerer hybrid flags their sorcerous powers with
 * castAs = "sorcery" (the Sorcery talents set it at grant time).
 */
export function resolveCasting(
	power: CastingPowerLike,
	actor: CastingActorLike,
): CastingContext {
	const override =
		power.castAs === "psychic" || power.castAs === "sorcery"
			? (power.castAs as CastingMode)
			: "";
	const sorcerer = isSorcerer(actor);
	const mode: CastingMode = override
		? override
		: sorcerer && actor.psyker !== true
			? "sorcery"
			: "psychic";

	const rating =
		mode === "sorcery"
			? sorceryPsyRating(actor.sorceryRank, actor.intelligenceBonus ?? 0)
			: Math.max(0, Math.floor(actor.psyRating ?? 0));

	return {
		mode,
		rating,
		// Sorcery makes the Focus Power Test Intelligence regardless of the
		// book's psyker-side characteristic (EA p85); the opponent still uses
		// Willpower on an opposed test.
		testKeyOverride: mode === "sorcery" ? "int" : "",
		// Sorcerers use the Renegade/Sorcerer row (EA p87); renegade psykers
		// are handled by the actor's sanctioned flag.
		sanctioned: mode === "sorcery" ? false : actor.sanctioned !== false,
		// "Whenever a Sorcerer is required to roll on the Psychic Phenomena
		// Table... he adds his Corruption Point total" (EA p86) — a per-
		// CHARACTER rule, so a hybrid's psychic powers add it too.
		phenomenaFlat: sorcerer ? Math.max(0, Math.floor(actor.corruption ?? 0)) : 0,
		ritualRequired: mode === "sorcery",
	};
}
