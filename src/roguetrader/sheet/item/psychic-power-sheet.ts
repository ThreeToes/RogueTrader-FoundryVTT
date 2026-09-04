const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { DamageType } from "../../data/item/damage-types";
import {
	psychicPowerClasses,
	psychicPowerSubtypes,
} from "../../data/item/psychic-power";

const labeled = (values: readonly string[]) =>
	Object.fromEntries(
		values.map((value) => [value, `PSYCHIC_POWER.${value.toUpperCase()}`]),
	);

export class PsychicPowerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "psychic-power"],
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
			template:
				"systems/rogue-trader/template/sheet/item/tabs/psychic-power-data.hbs",
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

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		context.powerClassChoices = labeled(psychicPowerClasses);
		context.subtypeChoices = labeled(psychicPowerSubtypes);
		context.damageTypeChoices = Object.fromEntries(
			Object.values(DamageType).map((value) => [value, value]),
		);
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
