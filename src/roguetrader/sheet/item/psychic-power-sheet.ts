const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { damageTypes } from "../../registry";
import { ITEM_DATA_TABS } from "../tabs";
import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import {
	psychicPowerClasses,
	psychicPowerSubtypes,
} from "../../data/item/psychic-power";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

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
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		tabs: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/tabs.hbs`,
		},
		data: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/psychic-power-data.hbs`,
		},
		notes: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/notes.hbs`,
		},
	};

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		context.powerClassChoices = labeled(psychicPowerClasses);
		context.subtypeChoices = labeled(psychicPowerSubtypes.choices);
		// Epic 0hap: how the owned copy is cast (blank inherits the actor).
		context.castAsChoices = {
			"": "",
			psychic: "PSYCHIC_POWER.CAST_AS_PSYCHIC",
			sorcery: "PSYCHIC_POWER.CAST_AS_SORCERY",
		};
		// Bead seeg: the shared damageTypes registry seed — localized like the
		// weapon/gear sheets (the raw-value map was an unlocalized copy).
		context.damageTypeChoices = damageTypes.choices;
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}
