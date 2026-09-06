/**
 * Shared drop-to-clone plumbing (bead meb2): resolving an external Item
 * uuid and cloning it onto a document's items was re-implemented in the
 * character sheet, the NPC sheet and the ship sheet. One helper, three
 * callers — the equip-state defaulting (NPC spec: dropped weapons arrive
 * carried, armour worn) and the already-owned no-op stay opt-in so each
 * sheet keeps its exact previous behaviour.
 */

export interface CloneItemOptions {
	/** Static merge into every cloned item's system data. */
	systemOverrides?: Record<string, unknown>;
	/**
	 * Per-type merge into the cloned item's system data (e.g. equipState
	 * defaults that depend on the source item's type).
	 */
	systemOverridesFor?: (sourceType: string) => Record<string, unknown>;
	/**
	 * No-op when the target already owns an item with the same uuid
	 * (drop-on-inventory semantics). Ship refit installs allow duplicates,
	 * so it opts out.
	 */
	skipOwned?: boolean;
}

/**
 * Resolve a uuid to an Item document and clone it onto `actor`. Returns the
 * created document, or undefined when the uuid did not resolve to an Item
 * (or was skipped as already-owned).
 */
export async function cloneItemIntoActor(
	actor: foundry.documents.Actor,
	uuid: string,
	options: CloneItemOptions = {},
): Promise<foundry.documents.Item | undefined> {
	const source = await foundry.utils.fromUuid(uuid);
	if (!(source instanceof foundry.documents.Item)) return undefined;
	if (options.skipOwned !== false && actor.items.find((i) => i.uuid === source.uuid)) {
		return undefined;
	}
	const payload = source.toObject() as { system?: Record<string, unknown> };
	const overrides = {
		...options.systemOverrides,
		...options.systemOverridesFor?.(source.type as string),
	};
	const created = (await actor.createEmbeddedDocuments("Item", [
		{ ...payload, system: { ...payload.system, ...overrides } },
	] as never)) as foundry.documents.Item[];
	return created[0];
}

/**
 * Read a drag event's {type, uuid} payload and, when it carries an Item,
 * clone it onto `actor` (see cloneItemIntoActor). Non-Item drops are no-ops.
 */
export async function cloneItemFromDrop(
	actor: foundry.documents.Actor,
	event: DragEvent,
	options: CloneItemOptions = {},
): Promise<foundry.documents.Item | undefined> {
	const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
		type?: string;
		uuid?: string;
	};
	if (data.type !== "Item" || !data.uuid) return undefined;
	return cloneItemIntoActor(actor, data.uuid, options);
}

/**
 * Equip-state defaults for dropped items (NPC spec): the NPC is holding/
 * wearing whatever the GM gives it — weapons arrive carried, armour worn,
 * everything else stowed.
 */
export function npcEquipDefault(type: string): string {
	if (type === "melee-weapon" || type === "ranged-weapon") return "carried";
	if (type === "armour") return "worn";
	return "stowed";
}

/** cloneItemFromDrop systemOverridesFor wiring for the NPC sheet. */
export function npcEquipDefaultSystemOverrides(
	sourceType: string,
): Record<string, unknown> {
	return { equipState: npcEquipDefault(sourceType) };
}