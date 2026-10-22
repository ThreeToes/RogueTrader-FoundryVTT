/**
 * SYSTEM_ID_FALLBACK (bead 6f99): the ONE pre-init system-id fallback.
 *
 * Foundry resolves `game.system` only during its init hook, so system code
 * that needs its own id before that (settings registration, settings reads,
 * the rules app) must carry a literal. That literal used to be written once
 * per call site — bootstrap/config.ts, presentation/rules-app.ts and
 * presentation/rolls/test-dialog.ts each held a private copy, because
 * importing bootstrap/config.ts back would be circular: config imports
 * presentation/rules-app.ts as its settings-menu type, so a presentation
 * file importing config would create a cycle.
 *
 * A domain leaf breaks the cycle: bootstrap and presentation may both import
 * `src/ffg/domain/` (architecture.test.ts), and this file touches no Foundry
 * global, so the three sites all fall back to these lines instead of three
 * private copies. `system-id.test.ts` pins that every site consumes it.
 *
 * This constant is RT's own id, the composition root of this repository. A
 * sibling system provides its own id through the usual seams (see
 * template-root.ts's sibling note) rather than reading this one.
 */

export const SYSTEM_ID_FALLBACK = "rogue-trader";