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
 * `applied` guards the double registration (HandlerRegistry.register appends,
 * it does not replace), and the keys are re-checked defensively so a caller
 * whose registry is already populated pays nothing.
 */

import { testContributors } from "../../ffg/application/funnel";
import { registerAttackContextContributor } from "./homebrew";
import { registerOriginTraitsContributor } from "./origin-traits";

/** Source types this module is responsible for (funnel registry keys). */
export const RT_FUNNEL_CONTRIBUTOR_TYPES = [
	"attack-context",
	"origin-traits",
] as const;

let applied = false;

/**
 * Register the RT-specific funnel contributors into the shared registry.
 * Idempotent: a repeat call (recomposed entry point, another test in the same
 * process, a future second caller) contributes nothing extra.
 */
export function registerRtFunnelContributors(): void {
	if (applied) return;
	const already = new Set(testContributors.types());
	if (
		RT_FUNNEL_CONTRIBUTOR_TYPES.every((type) => already.has(type))
	) {
		applied = true;
		return;
	}
	registerAttackContextContributor();
	registerOriginTraitsContributor();
	applied = true;
}