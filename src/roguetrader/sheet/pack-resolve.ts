/**
 * Robust compendium document resolution (bead wwuc root cause): fromUuid
 * resolved to undefined in-world for our LevelDB packs even when the pack
 * held the document, silently no-opping `item.sheet?.render(...)`. Resolve
 * the document DIRECTLY from the pack instead:
 * "Compendium.<pack>.<type>.<id>" -> game.packs.get("<pack>").getDocument(id).
 * fromUuid stays the fallback for non-compendium uuid shapes.
 */
export async function resolvePackDocument(
	uuid: string,
): Promise<unknown | null> {
	const parts = /^Compendium\.([^.]+)\.([^.]+)\.Item\.([^.]+)$/.exec(uuid);
	if (parts) {
		const pack = game.packs?.get(`${parts[1]}.${parts[2]}`);
		if (pack) {
			const doc = await (
				pack as unknown as {
					getDocument: (id: string) => Promise<unknown>;
				}
			).getDocument(parts[3]);
			if (!doc) {
				console.warn(
					`rogue-trader | pack document ${parts[3]} not found in ${parts[1]}.${parts[2]}`,
				);
			}
			return doc ?? null;
		}
		console.warn(`rogue-trader | compendium pack ${parts[1]}.${parts[2]} not found`);
		return null;
	}
	return (await foundry.utils.fromUuid(uuid)) ?? null;
}

/**
 * Fetch a compendium pack's documents (bead ku1i consolidation): one loud
 * missing-pack warning per fetch instead of 22 silent no-ops. Empty list
 * means "pack missing or empty" — callers that distinguish can check the
 * pack's existence separately.
 */
export async function getPackDocuments(packId: string): Promise<unknown[]> {
	const pack = game.packs?.get(packId);
	if (!pack) {
		console.warn(`rogue-trader | compendium pack ${packId} not installed`);
		return [];
	}
	return (await pack.getDocuments()) as unknown[];
}

/** Open a resolved document's sheet, loudly reporting a missing binding. */export async function openDocumentSheet(
	item: unknown,
	label: string,
): Promise<void> {
	const sheet = (item as { sheet?: { render: (o?: object) => unknown } }).sheet;
	if (!sheet) {
		console.error(`rogue-trader | ${label}: resolved document has no sheet:`, item);
		ui.notifications?.error(game.i18n!.localize("BACKGROUND.OPEN_CAREER_FAIL"));
		return;
	}
	await sheet.render({ force: true });
}
/**
 * Sheet action: open the compendium source of an owned item (bead kwm9,
 * shared by CharacterSheet + NpcSheet). Reads data-uuid off the target —
 * the packer stamps flags["rogue-trader"].compendiumSource on every
 * embedded item that resolves from a pack (et3x). Items without a stamp
 * (standalone book traits, homebrew) render no link, so a missing uuid is
 * a normal no-op.
 */
export async function openPackItemAction(
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const uuid = target.dataset.uuid;
	if (!uuid) return;
	try {
		const item = await resolvePackDocument(uuid);
		if (!item) {
			console.warn(`rogue-trader | pack item link: "${uuid}" did not resolve`);
			return;
		}
		await openDocumentSheet(item, "pack item link");
	} catch (error) {
		console.error("rogue-trader | pack item link failed:", error);
	}
}
