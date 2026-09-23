const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { effectActions, effectEditorChoices } from "./effect-actions";
import { ITEM_DATA_TABS } from "../tabs";
import { sheetContext } from "../context";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

export class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "gear",
		width: 500,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		data: {
			template: "systems/rogue-trader/template/sheet/item/tabs/data.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));

		// Context.tabs is a flat record keyed by tab id: { data: {...}, notes: {...} }.
		context.tabs = this._prepareTabs("primary");

		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) => game.i18n.localize(key)));

		// Tau battlesuit systems (bead i0dc) share this sheet: expose the category
		// and the Hard Point cost the suit's budget is spent on. Guarded so plain
		// gear renders exactly as before.
		if (this.document.type === "battlesuit-system") {
			const system = this.document.system as { category?: string; hardPointCost?: number };
			context.battlesuitSystem = {
				category: foundry.utils.getProperty(
					this.document,
					"system.category",
				),
				hardPointCost: system.hardPointCost ?? 0,
			};
		}

		context.descriptionHTML =
			await enrichText(
				this.document.system.description,
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}
