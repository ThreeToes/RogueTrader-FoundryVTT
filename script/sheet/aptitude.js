import { DarkHeresyItemSheet } from "./item.js";

export class AptitudeSheet extends DarkHeresyItemSheet {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["rogue-trader", "sheet", "aptitude"],
			template: "systems/rogue-trader/template/sheet/aptitude.hbs",
			width: 500,
			height: 369,
			tabs: [
				{
					navSelector: ".sheet-tabs",
					contentSelector: ".sheet-body",
					initial: "stats",
				},
			],
		});
	}
}
