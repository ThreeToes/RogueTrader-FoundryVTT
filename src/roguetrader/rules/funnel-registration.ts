/**
 * Explicit RT funnel-contributor registration (bead i4b0).
 *
 * The RT-specific funnel contributors (the attack-context fire-mode bonus in
 * homebrew.ts, the origin-trait modifiers in origin-traits.ts, and the
 * weapon-quality attack rows in weapon-qualities.ts) used to register
 * themselves at module evaluation, so the registry — a module-level
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
 * Idempotency is now reference de-dupe in `HandlerRegistry.on` itself (bead
 * 00z5): the exact RT contributor for a type key is appended only when that
 * handle is absent, so a repeat call contributes nothing extra. The keys-only
 * shape check of the old applied-guard is gone.
 *
 * Bead 00z5: the source-type keys register under RT's namespace
 * (RT_FUNNEL_NAMESPACE, the `createRegistries(seed, "ROGUE_TRADER")`
 * CONFIG-namespace precedent). A second FFG system registering its own
 * "attack-context" under its own namespace holds a separate handler list —
 * its rows can never merge with RT's, and modifier-id collisions
 * ("attack:fire-mode:burst") can no longer be resolved silently by module
 * import order.
 */

import {
	type TestContributor,
	testContributors,
} from "../../ffg/application/funnel";
import { attackContextContributor } from "./homebrew";
import { originTraitsContributor } from "./origin-traits";
import { weaponQualitiesContributor } from "./weapon-qualities";

/**
 * The namespace RT's contributors register under (bead 00z5), following the
 * `createRegistries(seed, "ROGUE_TRADER")` precedent: namespaced keys are
 * per-system storage slots in the shared funnel registry.
 */
export const RT_FUNNEL_NAMESPACE = "ROGUE_TRADER";

/** Source types this module is responsible for (funnel registry keys). */
export const RT_FUNNEL_CONTRIBUTOR_TYPES = [
	"attack-context",
	"origin-traits",
	"weapon-qualities",
] as const;

/** This module's contributors, each with its registry type key (bead 4tx6). */
const RT_FUNNEL_CONTRIBUTORS: ReadonlyArray<
	readonly [string, TestContributor]
> = [
	["attack-context", attackContextContributor],
	["origin-traits", originTraitsContributor],
	// Bead gyei: the LAST RT book table hoisted out of the neutral funnel —
	// one contributor for every seeded `weaponQualities` def.
	["weapon-qualities", weaponQualitiesContributor],
];

/**
 * Register the RT-specific funnel contributors into the shared registry,
 * namespaced under RT_FUNNEL_NAMESPACE so no other system's same-named
 * source types merge with them (bead 00z5). Idempotent: a repeat call
 * (recomposed entry point, another test in the same process, a future second
 * caller) contributes nothing extra — HandlerRegistry.on de-duplicates by
 * reference, so the exact RT contributor is registered only when absent.
 */
export function registerRtFunnelContributors(): void {
	for (const [type, fn] of RT_FUNNEL_CONTRIBUTORS) {
		testContributors.register(type, fn, RT_FUNNEL_NAMESPACE);
	}
}