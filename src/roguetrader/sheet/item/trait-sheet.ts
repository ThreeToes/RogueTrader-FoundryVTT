const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import { effectActions } from "./effect-actions";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

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
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		content: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/trait-content.hbs`,
		},
	};

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));

		// Item data keys (bead apxq): effect editor choices (bead bpd, localized
		// kind labels + test keys) + the enriched description prose.
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}
