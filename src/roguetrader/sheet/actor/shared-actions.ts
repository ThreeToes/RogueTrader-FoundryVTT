/**
 * Shared actor-sheet action handlers (bead 73di): the bodies both
 * CharacterSheet and NpcSheet carried verbatim, extracted following the
 * openPackItemAction function style (sheet/pack-resolve.ts) — `this` typed
 * as the minimal shape the sheet provides.
 *
 * Action NAMES stay on the sheets (templates depend on them); only the
 * bodies are shared here. The characteristic and skill roll bodies moved in
 * too (bead z4df): the old comment claiming #onRollSkill is deliberately not
 * shared was FALSE — both sheets read the shared data-item-id row vocabulary
 * (itemIdFromTarget) and both characteristic rolls read data-key on the
 * target, so there is no remaining divergence to record.
 */
import { itemIdFromTarget } from "../dom";
import { performRoll, rollWeaponDamage } from "../../rules/adapter";
import { isPsykerLike } from "../../rules/psyker";
import type { ActorView } from "../../../ffg/domain/model/actor";

/** Open an owned item's sheet (data-item-id on the target). */
export async function openItemAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const itemId = itemIdFromTarget(target);
	if (!itemId) return;
	const item = this.actor.items.get(itemId);
	if (item) item.sheet?.render(true);
}

/** Set the text/plain drag payload of an Item. */
export function startItemRowDrag(event: DragEvent): void {
	const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
		"[data-item-uuid]",
	);
	if (!row?.dataset.itemUuid) return;
	event.dataTransfer?.setData(
		"text/plain",
		JSON.stringify({ type: "Item", uuid: row.dataset.itemUuid }),
	);
}

/** Roll a characteristic from a clicked cell (data-key on the target). */
export async function rollCharacteristicAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const key = target.dataset.key;
	if (!key) return;
	await performRoll({
		kind: "characteristic",
		actor: this.actor,
		key,
		skipDialog: false,
	});
}

/** Roll a known skill row (item id via the shared data-item-id vocabulary). */
export async function rollSkillAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const itemId = itemIdFromTarget(target);
	if (!itemId) return;
	await performRoll({
		kind: "skill",
		actor: this.actor,
		itemId,
		skipDialog: false,
	});
}

/** Roll the to-hit test for a weapon row (data-item-id). */
export async function rollWeaponAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const itemId = itemIdFromTarget(target);
	if (!itemId) return;
	await performRoll({
		kind: "weapon",
		actor: this.actor,
		itemId,
	});
}

/** Quick damage roll from a weapon row — no to-hit test (data-item-id). */
export async function rollDamageAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const itemId = itemIdFromTarget(target);
	if (!itemId) return;
	await rollWeaponDamage(this.actor, itemId);
}

/**
 * Psyker gating for _prepareTabs (bead m4me): the psychic/psy tab renders
 * only for psykers — Navigators count (Core Rulebook p182), anyone with a
 * Psy Rating, or anyone who owns psychic/navigator powers. Each sheet
 * deletes ITS OWN tab id; the psyker predicate is shared here.
 *
 * Pure like the post-0c48 builders (bead nyns): the VIEW is resolved once
 * per render by the sheet's _prepareTabs and passed down — the gate never
 * builds its own, so the predicate reads the same view the context
 * builders read instead of re-copying the whole inventory mid-render.
 */
export function gatePsykerTab(
	view: ActorView,
	tabs: Record<string, foundry.applications.api.ApplicationV2.Tab>,
	tabId: string,
): Record<string, foundry.applications.api.ApplicationV2.Tab> {
	if (!isPsykerLike(view)) {
		delete tabs[tabId];
	}
	return tabs;
}
