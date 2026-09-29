/**
 * Shared actor-sheet action handlers (bead 73di): the bodies both
 * CharacterSheet and NpcSheet carried verbatim, extracted following the
 * openPackItemAction function style (sheet/pack-resolve.ts) — `this` typed
 * as the minimal shape the sheet provides.
 *
 * Action NAMES stay on the sheets (templates depend on them); only the
 * bodies are shared here. #onRollSkill is deliberately NOT shared: the
 * sheets read different data attributes (character: data-item, npc:
 * data-item-id).
 */
import { itemIdFromTarget } from "../dom";
import { performRoll, rollWeaponDamage } from "../../rules/adapter";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import { isPsykerLike } from "../../rules/psyker";

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
 */
export function gatePsykerTab(
	actor: foundry.documents.Actor,
	tabs: Record<string, foundry.applications.api.ApplicationV2.Tab>,
	tabId: string,
): Record<string, foundry.applications.api.ApplicationV2.Tab> {
	if (!isPsykerLike(actorView(actor))) {
		delete tabs[tabId];
	}
	return tabs;
}