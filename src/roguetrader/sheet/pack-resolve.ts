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

/** Open a resolved document's sheet, loudly reporting a missing binding. */
export async function openDocumentSheet(
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