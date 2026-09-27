/**
 * RT shim over the system-neutral roll pipeline (bead p7jv).
 *
 * The machinery (dialog contributor collection + the shared test step) was
 * hoisted to src/ffg/presentation/rolls/pipeline.ts, where nothing names
 * Rogue Trader: the roll-card template is `SystemProfile.rollCardTemplate`
 * DATA and the card flags are the namespaced `MessageFlags` shape.
 *
 * This shim keeps every existing import path working — rules/roll-system.ts
 * re-exports through it and the RT roll flows (fear, perform, …) import
 * `./pipeline` — with the RT roll flows themselves staying in roguetrader:
 * they are RT rules, not hoist candidates.
 */

export {
	dialogContributors,
	runTest,
} from "../../../ffg/presentation/rolls/pipeline";