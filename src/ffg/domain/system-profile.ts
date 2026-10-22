/**
 * Per-system rules profile for the kernel + creation/advancement/homebrew
 * maths (beads yszf + yojf, children of the multi-system epic hr6r).
 *
 * Everything that differs between FFG 40k systems must be expressed as
 * profile DATA, never as hardcoded constants inside the pure resolvers.
 * Sibling modules (DH2 starts at 1,000 xp, Only War at 600, etc.) supply
 * their own profile object and pass it to the resolvers; the pure
 * functions default to `rtCore` so existing RT callers need no changes.
 *
 * Lives in domain (not rules) because it is pure profile DATA that every
 * layer — infrastructure's config port included — must be able to import;
 * the architecture boundaries (epic kof0) forbid infrastructure -> rules.
 * Mirrors the pattern of src/rules-engine/profile.ts (RuleProfile /
 * rtCore) at the roguetrader layer.
 */

import {
	type CharacteristicGenerationPointBuy,
	type CreationXpEconomics,
	type EliteAdvanceFlatBase,
	type FireModes,
	type PsychicPushLevels,
	type RuleProfile,
	type UntrainedSkill,
	rtCore as rtCoreRuleProfile,
} from "../../rules-engine/index";
import { TEMPLATE_ROOT } from "./template-root";

/**
 * The two profile fields that are BRANDING rather than rules (bead w9sa.8).
 *
 * `ConfigPort.profile()` used to be typed on RT's `SystemProfile`, which forced
 * every system to carry RT's creation/advancement constants — so a sibling's
 * own profile (`DarkHeresyProfile`) could not be returned through the shared
 * port at all, the single biggest fork risk the w9sa.5 audit found (A1). Only
 * these two fields are genuinely "the system": the chat-flag namespace and the
 * roll-card template. Everything else on `SystemProfile` is RT RULES data a
 * sibling supplies under its own shape (see
 * `system-profile-dark-heresy.ts`'s header for why DH2 refuses the RT shape
 * outright rather than carrying meaningless zeros).
 *
 * Both stay OPTIONAL on the port so a system that does not brand yet still
 * satisfies `ConfigPort`; RT's profile carries both, so its consumers are
 * unchanged.
 */
export interface SystemBranding {
	/**
	 * Chat-message flag namespace (bead p7jv): the key under which the system
	 * writes and reads chat-card flags. System-specific DATA, not a hardcoded
	 * string — the chat-flag machinery resolves it via the config port.
	 */
	messageFlagNamespace: string;
	/**
	 * Handlebars template for the shared roll card (bead p7jv): the shared
	 * pipeline's `runTest` renders this through the chat port. System-specific
	 * branding DATA, like messageFlagNamespace — a sibling system points it at
	 * its own template and the hoisted pipeline machinery stays neutral.
	 */
	rollCardTemplate: string;
}

/**
 * Profile data for the pure creation/advancement/homebrew resolvers.
 *
 * COMPOSITION (bead yojf): this extends the rules-engine's RuleProfile, so
 * ONE object carries the kernel data (crit handling, hit locations,
 * characteristic vocabulary, wound/fate/psychic/critical-table extension
 * points) AND the creation/advancement constants. A sibling system builds a
 * single profile object and hands it to both the kernel resolvers and the
 * creation/advancement ones — there is no third competing profile type.
 *
 * SHARED VOCABULARY (bead cmio.2): every concept both FFG systems share is
 * typed ONCE in the kernel's `profile-vocabulary.ts`, and RT instantiates its
 * member of each union — the point-buy generation, the `levels` PsychicPush,
 * the flat-base EliteAdvanceCost. The member pinning is deliberate: an RT
 * profile cannot express a shape RT's book does not have (a dh2Core-style
 * `rating-over-base` push, a per-advance elite cost, a dice roll), so
 * cross-reading a member is a compile error rather than a silent wrong
 * answer.
 */
export interface SystemProfile extends RuleProfile, SystemBranding {
	/** Profile id, e.g. "rt-core". */
	id: string;
	/**
	 * Point-buy characteristic generation (Core Rulebook p14): base 25,
	 * 100-point budget, cap 20 per characteristic. RT's own member of the
	 * kernel's `CharacteristicGeneration` union; the roll member is DH2e's.
	 */
	generation: CharacteristicGenerationPointBuy;
	/** The character creator's final step index (see rules/creation.ts). */
	creatorLastStep: number;
	/**
	 * Creation xp economics (Core Rulebook p13): 5,000 granted, 4,500 already
	 * spent before the first advance is bought. `spentAtCreation` is the
	 * spent-xp LEDGER's seed value (bead r8mw) — the old
	 * `preSpentBaseline`'s semantic, now under the shared two-field struct
	 * DH2e instantiates the other way round (1,000 granted, 0 pre-spent).
	 */
	creationXpEconomics: CreationXpEconomics;
	/**
	 * Core fire-mode modifiers on attack tests (Core Rulebook p237), SIGNED:
	 * the Standard Attack adds nothing, a Semi-Auto Burst +10, a Full-Auto
	 * Burst +20. The shared `FireModes` shape; DH2e's values are its own
	 * (a -10 Full Auto Burst penalty, printed DH2e p226).
	 */
	fireModes: FireModes;
	/**
	 * Core Psychic Strength Push caps as the kernel union's `levels` member
	 * (Table 6-1, Core Rulebook p157): sanctioned +3, renegades/sorcerers +4.
	 */
	psychicPush: PsychicPushLevels;
	/**
	 * Untrained skill test rule (bead tval, Core Rulebook p74 + Dodge example
	 * p244): an untrained Basic Skill Test targets HALF the governing
	 * Characteristic, round down. `half-characteristic` is the RT Core model;
	 * `flat-penalty` is the fallback for a sibling system whose book uses a
	 * flat modifier row instead.
	 *
	 * Bead 3swn (owner ruling 2026-10-08): the halved value is the EFFECTIVE
	 * characteristic — the stored value plus the characteristic-keyed modifier
	 * rows the funnel applies for that characteristic (mutations/gear/origin
	 * traits), folded in before halving and emitted with NO separate
	 * characteristic-modifier rows; situational rows (dialog entries, "any
	 * test" wildcards) still apply on top, as on trained tests. The
	 * flat-penalty model stays on the raw value with the penalty as a visible
	 * funnel row.
	 *
	 * Bead rbap (owner decision 2026-10-08): condition-guarded, characteristic-keyed
	 * rows do NOT participate in untrained tests — at prepare the fold only reads
	 * unguarded rows and post-prepare the `untrained:` surrogate key never matches
	 * their characteristic key, so the row is neither folded nor offered/applyable;
	 * pinned by tests in presentation/rolls/roll-pipeline.test.ts.
	 */
	untrainedSkill: UntrainedSkill;
	/**
	 * Elite Advance base cost (Core Rulebook p39): GM-granted, base 500 xp.
	 * RT's member of the kernel's `EliteAdvanceCost` union — the RENAME that
	 * removed the same-name-type-mismatch hazard (DH2e's field used to share
	 * the name `eliteAdvanceBaseCost` while carrying the literal
	 * "per-advance"). Lifted out of rules/advancement.ts#ELITE_ADVANCE_BASE_COST
	 * as profile DATA (bead wxut.1); that constant stays the core value and
	 * the consumer switch happened in bead wxut.2. Domain may not import the
	 * rules layer (the architecture test), so the value is repeated here and
	 * pinned against the rules constant by rules/system-profile.test.ts —
	 * exactly the push-cap arrangement below.
	 */
	eliteAdvanceCost: EliteAdvanceFlatBase;
	/**
	 * Toxic weapon Toughness Test penalty per point of Damage taken from the
	 * toxic hit (Core Rulebook p117: -5). Lifted from
	 * rules/toxic.ts#TOXIC_PENALTY_PER_DAMAGE_POINT, same arrangement.
	 */
	penaltyPerDamagePoint: number;
	/**
	 * Battlesuit Critical Effect removal Test modifier (Tau Character Guide
	 * p31: Hard, -20). Lifted from
	 * rules/battlesuit-repair.ts#REPAIR_TEST_MODIFIER, same arrangement.
	 */
	repairTestModifier: number;
	/**
	 * Launcher ammunition auto-consume (epic ui4b): firing a loaded launcher
	 * can decrement the loaded ordnance's quantity by the shots spent. The
	 * book-accurate default is FALSE — the manual -1 chip — which is what
	 * rules/homebrew.ts#resolveAmmoAutoConsume falls back to. Lifted here so a
	 * GM can tune it as profile DATA instead of a code branch.
	 */
	ammoAutoConsume: boolean;
}

/** Rogue Trader core profile — the current hardcoded values, as data. */
export const rtCore: SystemProfile = {
	...rtCoreRuleProfile,
	id: "rt-core",
	generation: {
		// Core Rulebook p14: base 25, 100-point budget, cap 20 per
		// characteristic ("Allocating Points").
		model: "point-buy",
		base: 25,
		budget: 100,
		cap: 20,
	},
	creatorLastStep: 5,
	creationXpEconomics: {
		// Core Rulebook p13: 5,000 granted at creation, 4,500 already spent —
		// the spent-xp ledger's baseline.
		granted: 5000,
		spentAtCreation: 4500,
	},
	fireModes: {
		// Core Rulebook p237: the Standard Attack is a straight test (no
		// modifier); Semi-Auto Burst +10; Full-Auto Burst +20. Signed to match
		// the shared FireModes shape (DH2e's Full Auto is -10).
		standard: { modifier: 0, characteristic: "either" },
		semiAutoBurst: {
			modifier: 10,
			characteristic: "ballistic-skill",
			citation: "Core Rulebook p237",
		},
		fullAutoBurst: {
			modifier: 20,
			characteristic: "ballistic-skill",
			citation: "Core Rulebook p237",
		},
	},
	// As data: the values psychic.ts resolves (Table 6-1, p157) — the profile
	// must not depend on the rules layer. The kernel union's levels member.
	psychicPush: {
		model: "levels",
		caps: { sanctioned: 3, other: 4 },
	},
	// As data: the model prepareUntrainedSkill resolves (bead tval, Core
	// Rulebook p74: untrained Basic Skill Test = HALF the governing
	// Characteristic, round down; Sidebar "Treating Advanced Skills as Basic
	// Skills" p74 uses the same rule; Dodge example p244 — Ag 30 untrained →
	// target 15) — the profile must not depend on the rolls layer.
	untrainedSkill: { model: "half-characteristic" },
	messageFlagNamespace: "rogue-trader",
	rollCardTemplate: `${TEMPLATE_ROOT}chat/roll.hbs`,
	// Bead wxut.1 lifts of the rules-layer constants (see the field docs above:
	// domain cannot import the rules layer, so each value is repeated here and
	// pinned against its rules constant by rules/system-profile.test.ts).
	eliteAdvanceCost: { model: "flat-base", baseCost: 500 },
	penaltyPerDamagePoint: 5,
	repairTestModifier: -20,
	// Book-accurate default (epic ui4b): the manual -1 chip, NOT auto-consume.
	ammoAutoConsume: false,
};

/** Default profile the pure resolvers fall back to when none is supplied. */
export const DEFAULT_SYSTEM_PROFILE: SystemProfile = rtCore;