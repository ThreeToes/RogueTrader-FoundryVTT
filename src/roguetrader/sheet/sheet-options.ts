/**
 * Shared sheet DEFAULT_OPTIONS builder (bead 9dma).
 *
 * A plain options factory, deliberately NOT a base class: sheet/context.ts
 * records that a shared sheet base makes tsc non-terminating with this
 * fvtt-types version. Mirrors CreatorApplication.creatorOptions.
 *
 * Every item sheet wants the same window + form behaviour; only the class
 * slug, size and action handlers differ.
 */

import { imageActions } from "./image-actions";

const editImageAction = imageActions.editImage;

export function itemSheetOptions(config: {
	/** Extra class after "rogue-trader sheet". */
	slug: string;
	width: number;
	/** Fixed pixel height, or "auto". */
	height: number | "auto";
	/** The sheet's own action handlers, merged after the shared image edit. */
	actions?: Record<string, unknown>;
}): object {
	return {
		classes: ["rogue-trader", "sheet", config.slug],
		position: { width: config.width, height: config.height },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		// The shared header portraits persist via imageActions.editImage (core
		// only applies the pick with updateSource — never saved). Subclass
		// handlers merge AFTER so an override stays possible.
		actions: { editImage: editImageAction, ...config.actions },
	};
}