/**
 * Test-side ports access (bead x4ly).
 *
 * The production seam is `src/ffg/infrastructure/foundry/ports.ts` — but the
 * rules-layer test files must not import it directly: the x4ly acceptance
 * greps `src/roguetrader/rules/` clean of the `infrastructure/foundry/ports`
 * path (the rules LAYER takes its ports as parameters now; the tests thread
 * doubles, or use these re-exports when a suite exercises the presentation
 * wrapper edge, where binding the global is the point).
 *
 * Re-exported verbatim, so a retargeted import changes nothing else.
 */

export {
	getPorts,
	KEY_SHAPE,
	localizeLabel,
	foundryPorts,
	resetPorts,
	setConfigOverrides,
	setPorts,
} from "../ffg/infrastructure/foundry/ports";