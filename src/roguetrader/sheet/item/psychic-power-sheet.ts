const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { DamageType } from "../../data/item/damage-types";
import { ITEM_DATA_TABS } from "../tabs";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";
import {
	psychicPowerClasses,
	psychicPowerSubtypes,
} from "../../data/item/psychic-power";

const labeled = (values: readonly string[]) =>
	Object.fromEntries(
		values.map((value) => [value, `PSYCHIC_POWER.${value.toUpperCase()}`]),
	);

export class PsychicPowerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "psychic-power",
		width: 500,
		height: "auto",
	});

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

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		context.powerClassChoices = labeled(psychicPowerClasses);
		context.subtypeChoices = labeled(psychicPowerSubtypes);
		// Epic 0hap: how the owned copy is cast (blank inherits the actor).
		context.castAsChoices = {
			"": "",
			psychic: "PSYCHIC_POWER.CAST_AS_PSYCHIC",
			sorcery: "PSYCHIC_POWER.CAST_AS_SORCERY",
		};
		context.damageTypeChoices = Object.fromEntries(
			Object.values(DamageType).map((value) => [value, value]),
		);
		context.descriptionHTML =
			await enrichText(
				this.document.system.description,
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}
