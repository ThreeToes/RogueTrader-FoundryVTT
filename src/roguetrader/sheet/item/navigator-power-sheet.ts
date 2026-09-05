import { effectActions } from "./effect-actions";
import { NavigatorPower } from "../../data/item/navigator-power";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Single-section navigator power sheet (mirrors TalentSheet): header +
 * characteristic/mastery data + level prose in one scrollable element.
 */
export class NavigatorPowerSheet extends HandlebarsApplicationMixin(
	ItemSheetV2,
) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "navigator-power"],
		position: { width: 500, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: { ...effectActions },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/navigator-power.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
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