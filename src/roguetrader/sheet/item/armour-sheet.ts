import { Armour } from "../../data/item/armour";
import { bodyLocations } from "../../registry";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class ArmourSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "armour"],
		position: { width: 500, height: 500 },
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
			template: "systems/rogue-trader/template/sheet/item/tabs/armour-data.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.DATA" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as Armour;

		// Complete per-location record so every registry location shows a box.
		context.armourPoints = Object.fromEntries(
			bodyLocations
				.keys()
				.map((location) => [location, system.armourPoints[location] ?? 0]),
		);

		return context;
	}
}
