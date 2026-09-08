const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { sheetContext } from "../context";
import { effectActions, effectEditorChoices } from "./effect-actions";

/**
 * Single-section trait sheet (bead 25ii): header + benefit + effects editor +
 * description in one scrollable element, mirroring the TalentSheet anatomy
 * (all fields degrade to read-only HTML when not editable). Traits are
 * NPC-innate; no equip-state UI (always live, see data/item/effects.ts).
 */
export class TraitSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "trait"],
		position: { width: 500, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: { ...effectActions },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/trait-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options));

		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) =>
			game.i18n.localize(key),
		));

		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				(this.document.system as { description?: string }).description ?? "",
				{
					secrets: this.document.isOwner,
					relativeTo: this.document,
				},
			);
		return context;
	}
}