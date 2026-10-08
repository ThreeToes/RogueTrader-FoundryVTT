/**
 * Header-portrait editing that PERSISTS (owner report: portraits "reset after
 * a bit").
 *
 * The shared headers' portrait element (shared/parts/header-portrait.hbs)
 * carries data-action="editImage" data-field="img". Core dispatches that
 * action and applies the picked path with document.updateSource — a
 * CLIENT-side change that never reaches the database, so the portrait snaps
 * back on the next render/sync. This override persists the pick with
 * document.update instead, and for Actors also writes
 * prototypeToken.texture.src so placed/linked tokens follow the same art (the
 * "portrait per-actor at runtime" route: header click -> File Picker).
 *
 * Spread into every sheet whose header carries the portrait: actor sheets
 * register it next to their own actions; itemSheetOptions injects it for all
 * item sheets (the shared action-map idiom, like effect-actions.ts).
 */

/** The document subset the handler needs (actor sheets and item sheets both). */
interface ImageEditSheet {
	document: {
		/** "Actor" | "Item" | ... — drives the token-texture follow-up. */
		documentName?: string;
		update: (data: Record<string, unknown>) => Promise<unknown>;
	};
}

export const imageActions = {
	/** Header portrait (and any data-field image): open the picker, persist. */
	async editImage(
		this: ImageEditSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const field = target.dataset.field || "img";
		const current = target.getAttribute("src") ?? "";
		const doc = this.document;
		const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
		const picker = new FilePickerImpl({
			type: "image",
			current,
			callback: (path: string) => {
				if (!path) return;
				const update: Record<string, unknown> = { [field]: path };
				// Actors: keep the token texture in step so the canvas (placed or
				// linked token, re-created later) shows the new art too — a
				// portrait that only changes the sheet is not a portrait.
				if (doc.documentName === "Actor") {
					update.prototypeToken = { texture: { src: path } };
				}
				// Persist the pick (core stops at updateSource — never saved);
				// failure is loud, it must not silently revert again.
				doc.update(update).catch((error: unknown) => {
					console.error("rogue-trader | portrait update failed:", error);
				});
			},
		});
		await picker.browse();
	},
};