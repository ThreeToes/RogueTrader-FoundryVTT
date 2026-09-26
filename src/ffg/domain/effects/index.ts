/**
 * The effect engine (epic kof0, phase 2). Importing this module registers the
 * core effect kinds (side-effect import of `./specs`).
 */

import "./specs";

export {
	collectEffectModifiers,
	collectEffects,
	effectKinds,
} from "./registry";
export type {
	EffectChannel,
	EffectContext,
	EffectHit,
	EffectQuery,
	EffectSpec,
} from "./types";
