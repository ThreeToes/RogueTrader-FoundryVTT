/**
 * Chat-card actions (epic kof0, phase 5): the delegated click handlers for the
 * to-hit "Roll Damage" button and the damage "Apply" button.
 *
 * Extracted from the former sheet/init.ts composition root; this cohesive
 * presentation concern lives on its own. It
 * is Foundry-facing by design (chat DOM, ownership, notifications).
 */

import { getPorts } from "../infrastructure/foundry/ports";
import {
	type DamageApplyFlag,
	messageFlagNamespace,
	readMessageFlag,
} from "../../ffg/application/chat-flags";
import { applyDamageWithCriticals, postCriticalCard } from "../rules/criticals";
import { rollDamageForCard, rollToxicToughnessTest } from "../rules/adapter";
import { decrementQuantity } from "../rules/ordnance";
import {
	openDocumentSheet,
	resolvePackDocument,
} from "../sheet/pack-resolve";

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
	const data = readMessageFlag(getPorts(), message, "damageApply");
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
		// Namespace from the profile (bead p7jv): RT's value is
		// "rogue-trader", so the wire format is unchanged.
		flags: {
			[messageFlagNamespace(getPorts())]: {
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
 * Toxic Toughness Test from the damage card (bead d8bc): the card button
 * carries the target, hit location outcome and the damage taken so the
 * victim's Toughness Test (−5 per damage point) runs through the shared Test
 * machinery with the penalty as a visible funnel contributor. Ownership is
 * enforced by performRoll (a loud warn, not a silent no-op); the button
 * disables once clicked so a second click cannot double-fire while the
 * dialog is open.
 */
export async function toxicToughnessTestFromCard(
	button: HTMLButtonElement,
): Promise<void> {
	const targetUuid = button.dataset.target;
	const wounds = Number(button.dataset.wounds ?? 0);
	if (!targetUuid || !Number.isFinite(wounds) || wounds < 1) return;
	const target = foundry.utils.fromUuidSync(targetUuid) as unknown as
		| (Actor & { isOwner?: boolean })
		| null;
	if (!target) return;
	button.disabled = true;
	await rollToxicToughnessTest(target, wounds);
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
	const data = readMessageFlag(getPorts(), message, "damageRoll") as
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
			[messageFlagNamespace(getPorts())]: {
				damageRoll: { ...data, rolled: true },
			},
		},
	});
}

/**
 * Spend one unit of the fired ordnance from the damage card's usage chip
 * (bead 4obp, owner decision 2026-10-02): DECREMENT ONLY — the card shows
 * what fired and the remaining quantity, but NOTHING auto-consumes (bead
 * mrl4 owns that toggle). The fired item's uuid rides the button's data-uuid
 * (stamped by the profile funnel at damage time); the chip is the shooter's
 * tool, so the fired item's owner (or a GM, folded into isOwner by the
 * port) may spend it.
 *
 * The read/write/announce goes through the SHARED decrementQuantity helper
 * (bead 9b95 F1) so the manual chip and the auto-consume funnel cannot
 * drift apart: the chip's manual-spend semantics are `onEmpty: "clamp"`
 * (empty spends book a 0 and still report, non-finite quantity is refused
 * without a write); the funnel's are `onEmpty: "refuse"`.
 */
export async function spendOrdnanceFromCard(
	button: HTMLButtonElement,
): Promise<void> {
	const uuid = button.dataset.uuid;
	if (!uuid) return;
	const item = foundry.utils.fromUuidSync(uuid as never) as unknown as
		| { name?: string; isOwner?: boolean }
		| null;
	if (!item) return;
	// Spend permission = the fired item's owner or a GM — the same fails-
	// closed qiuo gate the auto-consume funnel uses (bead 9b95 F5), and the
	// same posture the apply-damage ownership gate keeps.
	if (!getPorts().permissions.canRoll(item)) return;
	// Disable BEFORE the helper: a second click while the write is in flight
	// must not double-spend.
	button.disabled = true;
	const next = await decrementQuantity(item, { onEmpty: "clamp" });
	if (next === null) return;
}

/**
 * Card title doc link (epic 61pk, bead qg4z): the pack-doc link library's
 * OPEN path for CHAT — the anchor the roll/damage templates stamp with
 * data-uuid opened the pack item's sheet read-only. Chat is not an
 * ApplicationV2, so this is NOT a data-action table entry: bootstrap/hooks.ts
 * delegates the click to this handler the same way it delegates the card
 * buttons. The loud-fail posture is the advancement dialog's precedent
 * (#onOpenPackDoc): console + notify, { uuid } so the placeholder interpolates.
 */
export async function openPackDocFromCard(
	anchor: HTMLAnchorElement,
): Promise<void> {
	const uuid = anchor.dataset.uuid ?? "";
	if (!uuid) return;
	try {
		const doc = await resolvePackDocument(uuid);
		if (!doc) {
			console.warn(`rogue-trader | chat doc link: "${uuid}" did not resolve`);
			getPorts().notify.error("CHAT.OPEN_DOC_FAIL", { uuid });
			return;
		}
		await openDocumentSheet(doc, "chat doc link", "CHAT.OPEN_DOC_FAIL", {
			uuid,
		});
	} catch (error) {
		console.error("rogue-trader | chat doc link failed:", error);
		getPorts().notify.error("CHAT.OPEN_DOC_FAIL", { uuid });
	}
}
