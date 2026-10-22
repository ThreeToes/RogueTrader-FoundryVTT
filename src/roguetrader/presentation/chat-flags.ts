/**
 * Foundry-bound chat-flag wrappers (bead x4ly) — the port-binding edge.
 *
 * `readRtFlag` / `rtFlagPath` / `postCard` used to live in rules/chat-flags.ts,
 * where the rules layer called the global `getPorts()` accessor directly,
 * which made a second FFG system fork the rules layer to bind its OWN port
 * set. The wrappers are presentation: they read the global `getPorts()` here
 * — the layer that is allowed to own it — and `rules/chat-flags.ts` re-exports
 * these names so every established import path keeps working until callers
 * migrate.
 */

import {
	type MessageFlagPayload,
	type MessageFlags,
	messageFlagNamespace,
	postCard as postGenericCard,
	readMessageFlag,
} from "../../ffg/application/chat-flags";
import { getPorts } from "../infrastructure/foundry/ports";

/** Extract a system flag off a chat message (or flag payload). */
export function readRtFlag<T extends keyof MessageFlagPayload>(
	message: { flags?: Record<string, Record<string, unknown>> } | undefined,
	flag: T,
): MessageFlagPayload[T] | undefined {
	return readMessageFlag(getPorts().config, message, flag);
}

/**
 * The dotted document-update path for a system flag (e.g. ActiveEffect data
 * writes: `flags.<namespace>.snapOut`). The namespace is profile DATA (bead
 * pwn0); previously this path was hardcoded around "rogue-trader".
 */
export function rtFlagPath(flag: string): string {
	return `flags.${messageFlagNamespace(getPorts().config)}.${flag}`;
}

/**
 * Post a roll card: render the template and create the chat message with
 * speaker + flags. The single shared tail of every roll pipeline.
 *
 * `rolls` (bead wvkd): the evaluated dice the card reports, passed to the
 * generic postCard and on to `ports.chat.post` so the message is roll-type and
 * Dice So Nice! animates it.
 */
export async function postCard(
	actor: { uuid?: string },
	template: string,
	vars: Record<string, unknown>,
	flags?: MessageFlags,
	rolls?: readonly unknown[],
): Promise<{ id?: string } | undefined> {
	return postGenericCard(getPorts().chat, actor, template, vars, flags, rolls);
}