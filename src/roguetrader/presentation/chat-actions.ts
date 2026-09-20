/**
 * Chat-card actions (epic kof0, phase 5): the delegated click handlers for the
 * to-hit "Roll Damage" button and the damage "Apply" button.
 *
 * Extracted from the composition root (sheet/init.ts) so that file stays a
 * bootstrap module and this cohesive presentation concern lives on its own. It
 * is Foundry-facing by design (chat DOM, ownership, notifications).
 */

import { getPorts } from "../infrastructure/foundry/ports";
import type { DamageApplyFlag } from "../rules/chat-flags";
import { applyDamageWithCriticals, postCriticalCard } from "../rules/criticals";
import { rollDamageForCard } from "../rules/adapter";

/**
 * Apply the wounds shown on a damage chat card to the flagged target
 * (bead ncc). Consumes the card's data-only kernel outcome; guards
 * double-application via the message flag; ownership enforced here.
 */
export async function applyDamageFromCard(
	button: HTMLButtonElement,
): Promise<void> {
	const messageEl = button.closest<HTMLElement>(".message");
	const messageId = messageEl?.dataset.messageId;
	const message = messageId
		? (foundry.documents.ChatMessage.get(messageId) as unknown as {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
			})
		: undefined;
	const data = message?.flags?.["rogue-trader"]?.damageApply as
		| DamageApplyFlag
		| undefined;
	if (!message || !data || data.applied) {
		// Fallback: the button itself carries the outcome (data-target /
		// data-wounds) - usable even when the message flag is missing, e.g.
		// on cards created before the flag existed.
		const fallbackWounds = Number(button.dataset.wounds ?? 0);
		const fallbackTarget = button.dataset.target;
		if (!fallbackTarget || !fallbackWounds) return;
		applyToTarget(fallbackTarget, fallbackWounds, message, button).catch(
			(error) => console.error("rogue-trader: apply-damage failed", error),
		);
		return;
	}
	await applyToTarget(
		data.targetUuid ?? "",
		Number(data.wounds ?? 0),
		message,
		button,
		{ ...data },
	);
}

/** Shared apply path: resolve target, enforce ownership, clamp, update. */
async function applyToTarget(
	targetUuid: string,
	woundsAmount: number,
	message:
		| {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
		  }
		| undefined,
	button: HTMLButtonElement,
	existing?: DamageApplyFlag,
): Promise<void> {
	const target = targetUuid
		? (foundry.utils.fromUuidSync(targetUuid) as unknown as {
				system?: { wounds?: { value: number; max: number } };
				isOwner?: boolean;
				update: (u: object) => Promise<void>;
			} | null)
		: null;
	const wounds = target?.system?.wounds;
	if (!target || !wounds) return;
	// Only the defender's owner (or a GM) may apply the wounds.
	const user = game as unknown as { user?: { isGM?: boolean } };
	if (!target.isOwner && !user.user?.isGM) return;

	const effective: DamageApplyFlag = { ...(existing ?? {}) };
	button.disabled = true;
	// Wounds first, then Critical Damage for whatever runs past 0 (bead ks3k).
	// The card carries the damage type + hit location so the right critical
	// table is used; a card posted before that flag existed falls back to
	// Impact/Body rather than refusing to apply the damage.
	const outcome = await applyDamageWithCriticals({
		actor: target,
		damage: Number(woundsAmount ?? 0),
		damageType: effective.damageType ?? "Impact",
		location: effective.location ?? "",
	});
	if (message) {
		await message.update({
			flags: {
				"rogue-trader": {
					damageApply: {
						...effective,
						wounds: woundsAmount,
						targetUuid,
						applied: true,
					},
				},
			},
		});
	}
	await postCriticalCard(
		target as unknown as { uuid?: string },
		outcome,
		{
			damageType: effective.damageType ?? "Impact",
			location: effective.location ?? "",
		},
	);
	getPorts().notify.info("DAMAGE.APPLIED", { wounds: outcome.woundsApplied });
}

/**
 * Roll damage from the to-hit card's button (owner redesign): reads the
 * damageRoll flag set at attack time, guards double-rolls via the
 * rolled marker, and delegates to the adapter's damage flow.
 */
export async function rollDamageButton(
	button: HTMLButtonElement,
): Promise<void> {
	const messageEl = button.closest<HTMLElement>(".message");
	const messageId = messageEl?.dataset.messageId;
	const message = messageId
		? (foundry.documents.ChatMessage.get(messageId) as unknown as {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
			})
		: undefined;
	const data = message?.flags?.["rogue-trader"]?.damageRoll as
		| {
				attackerUuid?: string;
				weaponUuid?: string;
				targetUuid?: string | null;
				rolled?: boolean;
		  }
		| undefined;
	if (!message || !data || data.rolled) return;
	button.disabled = true;
	await rollDamageForCard(data as never);
	await message.update({
		flags: {
			"rogue-trader": {
				damageRoll: { ...data, rolled: true },
			},
		},
	});
}
