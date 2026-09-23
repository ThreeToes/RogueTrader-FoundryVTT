const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { sheetContext } from "../context";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";
import { effectActions, effectEditorChoices } from "./effect-actions";

/**
 * Single-section trait sheet (bead 25ii): header + benefit + effects editor +
 * description in one scrollable element, mirroring the TalentSheet anatomy
 * (all fields degrade to read-only HTML when not editable). Traits are
 * NPC-innate; no equip-state UI (always live, see data/item/effects.ts).
 */
export class TraitSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "trait",
		width: 500,
		height: "auto",
		actions: { ...effectActions },
	});

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
		const context = sheetContext(await super._prepareContext(options as never));

		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) =>
			game.i18n.localize(key),
		));

		context.descriptionHTML =
			await enrichText(
				(this.document.system as { description?: string }).description ?? "",
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}