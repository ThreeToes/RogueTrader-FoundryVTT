/**
 * TEMPLATE_ROOT (bead qezr): the one constant for every Foundry template
 * path under this system. Foundry loads templates by literal string at
 * template-load time, so a root move used to mean a ~100-site string hunt;
 * now it is this line.
 *
 * SYSTEM-DERIVED ROOT (bead w9sa.9), with a documented limitation.
 *
 * `templateRootFor(systemId)` is the reusable primitive: the root under ANY
 * system id, so a sibling system composes its own paths from one call instead
 * of a string hunt of its own.
 *
 * `TEMPLATE_ROOT` itself stays a CONSTANT evaluated at module load, and that is
 * a deliberate limit rather than an oversight. The alternative — a getter that
 * follows an id registered at init — cannot work, because the consumers that
 * need it (`rtCore.rollCardTemplate`, and every `TEMPLATE_ROOT`-prefixed
 * template path) build their strings at MODULE-LOAD time, which happens before
 * Foundry's init hook and therefore before any bootstrap could register the
 * running system's id. A pure domain module also cannot read `game.system`
 * itself: the architecture test forbids Foundry globals in the inner layers.
 *
 * So for a sibling system sharing this tree the supported path is NOT this
 * constant but the profile's own `rollCardTemplate`
 * (`src/ffg/domain/system-profile.ts`, the `SystemBranding` seam added by bead
 * w9sa.8): a sibling supplies its own path — built with `templateRootFor(<its
 * id>)` — and the shared roll pipeline renders that. What this file does is
 * make sure the sibling's composition is a one-liner, and that no RT path can
 * leak into a sibling's messages.
 *
 * WHAT WAS REJECTED AND WHY: registering the id in a no-import module loaded
 * before the rest of the graph. It depends on manifest script ordering and on
 * `game.system` existing that early, neither of which can be verified without a
 * running Foundry, and a wrong guess silently renders the wrong card — exactly
 * the class of bug this repo refuses to ship.
 */

/** The Rogue Trader system id, and therefore this project's root. */
export const DEFAULT_SYSTEM_ID = "rogue-trader";

/** Rogue Trader's own template root. */
export const TEMPLATE_ROOT = `systems/${DEFAULT_SYSTEM_ID}/template/`;

/** The template root under any system id, for the sibling-system path. */
export function templateRootFor(systemId: string): string {
	return `systems/${systemId}/template/`;
}
