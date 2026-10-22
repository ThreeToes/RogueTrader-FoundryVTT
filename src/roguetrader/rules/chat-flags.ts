/**
 * Typed chat-message flags + the shared card poster — RT shim (bead p7jv).
 *
 * The generic machinery (DamageRollFlag / DamageApplyFlag shapes, the flag
 * reader, postCard) moved to src/ffg/application/chat-flags.ts so sibling 40k
 * systems can reuse it. The flag NAMESPACE is no longer a hardcoded
 * "rogue-trader" string: it is profile DATA
 * (`SystemProfile.messageFlagNamespace`) resolved through the config port.
 *
 * This shim keeps the established import paths (rules/adapter.ts,
 * rules/criticals.ts, presentation/rolls/*, sheet/*) and the RT-flavoured
 * types working.
 *
 * Bead x4ly: the Foundry-bound wrapper bodies (`readRtFlag` / `rtFlagPath` /
 * `postCard`) moved to presentation/chat-flags.ts — binding the global
 * `getPorts()` is the presentation layer's job, not the rules layer's — and
 * are re-exported here so every established import path keeps working until
 * callers migrate.
 */

// The flag shapes are system-neutral; re-export them under the same names.
export type {
	DamageApplyFlag,
	DamageRollFlag,
	MessageFlagPayload,
	MessageFlags,
} from "../../ffg/application/chat-flags";

export {
	postCard,
	readRtFlag,
	rtFlagPath,
} from "../presentation/chat-flags";

/**
 * The RT chat-message flag shape. The literal namespace remains the type key
 * for RT call sites (it matches the profile value in rtCore); a sibling
 * system writes its own shape from its own profile.
 */
import { type MessageFlags } from "../../ffg/application/chat-flags";

export type RtMessageFlags = MessageFlags<"rogue-trader">;