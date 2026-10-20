/**
 * Explicit RT funnel-contributor registration (bead i4b0).
 *
 * The RT-specific funnel contributors (the attack-context fire-mode bonus in
 * homebrew.ts and the origin-trait modifiers in origin-traits.ts) used to
 * register themselves at module evaluation, so the registry — a module-level
 * singleton in ffg/application/funnel.ts — was only correct for callers whose
 * import graph happened to load this module's imports first (production boot
 * worked through the rules/funnel shim via the orchestrator). A test or future
 * caller importing the pipeline or the adapter directly silently lost the
 * rows — the "silent modifiers are bugs" class.
 *
 * This module makes the registration a named, idempotent function: RT roll
 * entry points call `registerRtFunnelContributors()` directly, and the
 * rules/funnel shim keeps calling it so existing shim imports keep working.
 *
 * The applied-guard is IDENTITY-based (bead 4tx6): only the exact RT
 * contributor function for a type key counts as already applied (checked by
 * reference against the registry). The old keys-only check would have been
 * satisfied by a FOREIGN module registering "attack-context"/"origin-traits"
 * first — silently skipping the RT fns and re-opening the missing-row class
 * i4b0 exists to kill. With the identity check a foreign registration is
 * appended beside, never substituted for, the RT fns.
 */

import {
	type TestContributor,
	testContributors,
} from "../../ffg/application/funnel";
import { attackContextContributor } from "./homebrew";
import { originTraitsContributor } from "./origin-traits";

/** Source types this module is responsible for (funnel registry keys). */
export const RT_FUNNEL_CONTRIBUTOR_TYPES = [
	"attack-context",
	"origin-traits",
] as const;

/** This module's contributors, each with its registry type key (bead 4tx6). */
const RT_FUNNEL_CONTRIBUTORS: ReadonlyArray<
	readonly [string, TestContributor]
> = [
	["attack-context", attackContextContributor],
	["origin-traits", originTraitsContributor],
];

/**
 * Register the RT-specific funnel contributors into the shared registry.
 * Idempotent: a repeat call (recomposed entry point, another test in the
 * same process, a future second caller) contributes nothing extra — each
 * type key is registered only when the EXACT RT contributor for it is absent.
 */
export function registerRtFunnelContributors(): void {
	for (const [type, fn] of RT_FUNNEL_CONTRIBUTORS) {
		if (!testContributors.contributorsFor(type).includes(fn)) {
			testContributors.register(type, fn);
		}
	}
}