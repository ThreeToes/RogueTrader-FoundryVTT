/**
 * Typed chat-message flags + the shared card poster (bead mvu2).
 *
 * The DamageRollFlag / damageApply shapes were previously duplicated inline
 * in rules/adapter.ts and sheet/init.ts; both live here now, along with
 * postCard — the one renderTemplate + ChatMessage.create sequence every
 * roll card goes through.
 */

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
	const content = await foundry.applications.handlebars.renderTemplate(
		template,
		vars,
	);
	const message = (await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
		...(flags ? { flags } : {}),
	})) as { id?: string } | undefined;
	return message;
}