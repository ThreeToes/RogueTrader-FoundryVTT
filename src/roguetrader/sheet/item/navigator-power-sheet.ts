import { effectActions } from "./effect-actions";
import { NavigatorPower } from "../../data/item/navigator-power";
import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Single-section navigator power sheet (mirrors TalentSheet): header +
 * characteristic/mastery data + level prose in one scrollable element.
 */
export class NavigatorPowerSheet extends HandlebarsApplicationMixin(
	ItemSheetV2,
) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "navigator-power",
		width: 500,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		content: {
			template: `${TEMPLATE_ROOT}sheet/item/navigator-power.hbs`,
		},
	};

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		context.characteristicChoices = NavigatorPower.characteristicChoices;
		context.masteryChoices = Object.fromEntries(
			["novice", "adept", "master"].map((m) => [
				m,
				`NAVIGATOR_POWER.${m.toUpperCase()}`,
			]),
		);
		// Read-only display label for the characteristic select.
		context.characteristicLabel = game.i18n.localize(
			`CHARACTERISTIC.${(this.document.system.characteristic ?? "per").toUpperCase()}`,
		);
		context.masteryBonus = (
			this.document.system as unknown as NavigatorPower
		).masteryBonusValue;
		context.levels = this.document.system.levels ?? {
			novice: "",
			adept: "",
			master: "",
		};
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}
