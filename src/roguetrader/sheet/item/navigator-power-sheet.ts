import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { NavigatorPower } from "../../data/item/navigator-power";
// Bead iktx: the ONE characteristic-label composition seam (labels.ts).
import { characteristicLabelKey } from "../../rules/labels";
import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import { effectActions } from "./effect-actions";

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
		// Read-only display labels for the characteristic and mastery selects.
		// BOTH are RESOLVED HERE, not keyed in the template: the schema stores
		// lowercase choices ("perception", "novice"), and the lang keys are
		// upper-snake — the old `{{localize (concat "NAVIGATOR_POWER."
		// document.system.mastery)}}` built the lowercase key, so this row
		// rendered the literal "NAVIGATOR_POWER.novice" on every sheet. Every
		// other composition site already upper-cases (see the characteristicLabel
		// line below and creator-context.ts); these two are the same seam.
		context.characteristicLabel = game.i18n.localize(
			characteristicLabelKey(this.document.system.characteristic ?? "per"),
		);
		context.masteryLabel = game.i18n.localize(
			`NAVIGATOR_POWER.${(this.document.system.mastery ?? "novice").toUpperCase()}`,
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
