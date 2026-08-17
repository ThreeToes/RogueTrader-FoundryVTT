import { DarkHeresyItemSheet } from "./item.js";

export class TalentSheet extends DarkHeresyItemSheet {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["rogue-trader", "sheet", "talent"],
			template: "systems/rogue-trader/template/sheet/talent.hbs",
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

	_getHeaderButtons() {
		let buttons = super._getHeaderButtons();
		buttons = [].concat(buttons);
		return buttons;
	}

	activateListeners(html) {
		super.activateListeners(html);
	}
}
