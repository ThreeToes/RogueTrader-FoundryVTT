const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "gear"],
		position: { width: 500, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
	};

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

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.DATA" },
				{ id: "notes", group: "primary", label: "TAB.DESCRIPTION" },
			],
			initial: "data",
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		// Context.tabs is a flat record keyed by tab id: { data: {...}, notes: {...} }.
		context.tabs = this._prepareTabs("primary");

		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				this.document.system.description,
				{
					secrets: this.document.isOwner,
					relativeTo: this.document,
				},
			);
		return context;
	}
}
