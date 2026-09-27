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
 */

import {
	type DamageApplyFlag,
	type DamageRollFlag,
	messageFlagNamespace,
	type MessageFlagPayload,
	type MessageFlags,
	postCard as postGenericCard,
	readMessageFlag,
} from "../../ffg/application/chat-flags";
import { getPorts } from "../infrastructure/foundry/ports";

// The flag shapes are system-neutral; re-export them under the same names.
export type { DamageApplyFlag, DamageRollFlag, MessageFlagPayload, MessageFlags };

/**
 * The RT chat-message flag shape. The literal namespace remains the type key
 * for RT call sites (it matches the profile value in rtCore); a sibling
 * system writes its own shape from its own profile.
 */
export type RtMessageFlags = MessageFlags<"rogue-trader">;

/** Extract a system flag off a chat message (or flag payload). */
export function readRtFlag<T extends keyof MessageFlagPayload>(
	message: { flags?: Record<string, Record<string, unknown>> } | undefined,
	flag: T,
): MessageFlagPayload[T] | undefined {
	return readMessageFlag(getPorts(), message, flag);
}

/**
 * The dotted document-update path for a system flag (e.g. ActiveEffect data
 * writes: `flags.<namespace>.snapOut`). The namespace is profile DATA (bead
 * pwn0); previously this path was hardcoded around "rogue-trader".
 */
export function rtFlagPath(flag: string): string {
	return `flags.${messageFlagNamespace(getPorts())}.${flag}`;
}

/**
 * Post a roll card: render the template and create the chat message with
 * speaker + flags. The single shared tail of every roll pipeline.
 */
export async function postCard(
	actor: { uuid?: string },
	template: string,
	vars: Record<string, unknown>,
	flags?: MessageFlags,
): Promise<{ id?: string } | undefined> {
	return postGenericCard(getPorts(), actor, template, vars, flags);
}