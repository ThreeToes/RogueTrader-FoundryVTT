/**
 * Typed chat-message flags + the shared card poster (bead mvu2).
 *
 * The DamageRollFlag / damageApply shapes were previously duplicated inline
 * in rules/adapter.ts and sheet/init.ts; both live here now, along with
 * postCard — the one renderTemplate + ChatMessage.create sequence every
 * roll card goes through.
 *
 * PLACEMENT (epic kof0, bead xkad): this module deliberately stays in rules/
 * rather than moving to presentation/ with the roll handlers. It is the only
 * one that is genuinely shared — the flag INTERFACES are the data contract
 * between the rules that write them (adapter, criticals) and the presentation
 * that reads them (chat-actions), and postCard is a two-line wrapper over the
 * Chat port. Moving it either way would make one side import "upward" for a
 * data shape. Everything that is purely a handler or a dialog lives in
 * presentation/.
 */

import { getPorts } from "../infrastructure/foundry/ports";

/** Card button data for the manual damage roll (to-hit card button). */
export interface DamageRollFlag {
	attackerUuid?: string;
	weaponUuid?: string;
	targetUuid?: string | null;
	hitRoll?: number;
	/** To-hit outcome was critical (gates critical-damage talent effects). */
	critical?: boolean;
	rolled?: boolean;
}

/** Apply-damage button data (damage card button, bead ncc). */
export interface DamageApplyFlag {
	wounds?: number;
	targetUuid?: string;
	applied?: boolean;
	/**
	 * Damage type + hit location (bead ks3k): the apply step needs both to pick
	 * the right critical table once wounds run out. The card already displays
	 * them, so this only stops the click handler recomputing them.
	 */
	damageType?: string;
	location?: string;
}

/** The system's chat-message flag namespace. */
export interface RtMessageFlags {
	"rogue-trader"?: {
		damageRoll?: DamageRollFlag;
		damageApply?: DamageApplyFlag;
	};
}

/** Extract a system flag off a chat message (or flag payload). */
export function readRtFlag<T extends keyof NonNullable<
	RtMessageFlags["rogue-trader"]
>>(
	message: { flags?: Record<string, Record<string, unknown>> } | undefined,
	flag: T,
): NonNullable<RtMessageFlags["rogue-trader"]>[T] | undefined {
	return message?.flags?.["rogue-trader"]?.[flag] as
		| NonNullable<RtMessageFlags["rogue-trader"]>[T]
		| undefined;
}

/**
 * Post a roll card: render the template and create the chat message with
 * speaker + flags. The single shared tail of every roll pipeline.
 */
export async function postCard(
	actor: { uuid?: string },
	template: string,
	vars: Record<string, unknown>,
	flags?: RtMessageFlags,
): Promise<{ id?: string } | undefined> {
	return getPorts().chat.post(actor, template, vars, flags);
}
