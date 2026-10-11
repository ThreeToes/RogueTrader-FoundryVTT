/**
 * The Dark Heresy 2nd Edition profile, BRANDED (bead w9sa.4).
 *
 * This module is where the sibling system's identity lives. Everything here is
 * either the shared DH2 data object (`dh2Core`, from the shared domain layer —
 * every value carries its page citation there) or the two `SystemBranding`
 * fields the widened config port accepts (bead w9sa.8). NOTHING here restates
 * a rule value: a number rewritten beside its own citation is a fork waiting to
 * happen, so the kernel data is spread and only branding is added.
 *
 * WHY THIS FILE IS NOT IN src/ffg: the shared layers must stay system-neutral
 * (see the neutrality assertion in src/roguetrader/architecture.test.ts — they
 * may not even name this system), so the sibling's own branding has to live
 * outside them. It imports the shared data and hands the result to the shared
 * seam; the shared seam never learns the sibling's name.
 */

import type { ConfigProfile } from "../ffg/application/ports";
import { DH2_SYSTEM_ID } from "../ffg/domain/rule-knobs-dark-heresy";
import type { SystemBranding } from "../ffg/domain/system-profile";
import { dh2Core } from "../ffg/domain/system-profile-dark-heresy";
import { templateRootFor } from "../ffg/domain/template-root";

/**
 * Chat-message flag namespace (bead p7jv): the key under which this system
 * writes and reads chat-card flags. RT uses its own system id for the same
 * purpose, so DH2 uses its own.
 */
export const DARK_HERESY_MESSAGE_FLAG_NAMESPACE = DH2_SYSTEM_ID;

/**
 * The shared roll pipeline's card template (bead w9sa.8 makes it profile
 * BRANDING, and bead w9sa.9's `templateRootFor` makes the root one call), so
 * the DH2 path is COMPOSED from the system id rather than written out — the same
 * idiom as RT's `${TEMPLATE_ROOT}chat/roll.hbs`.
 *
 * The FILE under it is a later deliverable (the DH2 presentation/content work,
 * epic eg4g): the shared pipeline throws loudly naming this path if a roll is
 * attempted before it exists, rather than rendering an unresolved card. That is
 * the repo's loud-hole convention, and it is why the path is named now.
 */
export const DARK_HERESY_ROLL_CARD_TEMPLATE = `${templateRootFor(DH2_SYSTEM_ID)}chat/roll.hbs`;

/**
 * The RollTables pack id the content port probes for the critical-hit charts
 * and the Psychic Phenomena tables.
 *
 * NULL ON PURPOSE, and not a placeholder: DH2 ships no compendium packs yet
 * (that is epic eg4g's content work), and the content port reads `null` as
 * "no packs installed" — the documented content-optional baseline, where every
 * roll still works by hand. Naming a pack id that does not exist would make
 * the port warn about a missing pack on every boot, which is worse than the
 * honest null. Set the id here, once, when the DH2 rolltables pack exists.
 */
export const DARK_HERESY_ROLLTABLES_PACK: string | null = null;

/** The two branding fields, as their own object so the spread stays readable. */
const DARK_HERESY_BRANDING: SystemBranding = {
	messageFlagNamespace: DARK_HERESY_MESSAGE_FLAG_NAMESPACE,
	rollCardTemplate: DARK_HERESY_ROLL_CARD_TEMPLATE,
};

/**
 * The sibling's profile as the widened config port accepts it: `dh2Core`'s
 * kernel data plus DH2's branding, and NOT ONE of RT's creation/advancement
 * constants (`characteristicBase`, `pointBuyBudget`, `fireModeBonus`,
 * `pushCap`, `untrainedSkill`, `eliteAdvanceBaseCost`, ...) — which is exactly
 * the shape the old `profile(): SystemProfile` refused (audit finding A1).
 *
 * THE ONE CAST, AND WHY IT IS HERE: `DarkHeresyProfile` deliberately
 * re-declares the fields the kernel types non-optionally as `T | undefined`
 * (bead w9sa.1 pinning what the book verifies — `critOnDouble`,
 * `autoFailRoll`, `autoPassRoll`, `primitiveArmourDouble`) and re-types
 * `startingWounds`/`startingFate` under DH2's own union models. The widened
 * port promises the KERNEL shape (`RuleProfile & Partial<SystemBranding>`), so
 * the DH2 object is one `as` away from the port it travels through. The cast
 * covers ONLY those annotations: every VALUE is `dh2Core`'s own, spread
 * unmodified, and `src/dark_heresy_2e/bootstrap/index.test.ts` reads each
 * kernel field back off `dh2Core` so the cast cannot hide a restated number.
 *
 * Closing the hole properly is a SHARED-LAYER decision the parent owns: either
 * the port accepts the sibling's `| undefined` unions, or bead w9sa.1's pinning
 * moves to the consumer side. Neither is this bead's call.
 */
export const DARK_HERESY_PROFILE: ConfigProfile = {
	...dh2Core,
	...DARK_HERESY_BRANDING,
} as ConfigProfile;
