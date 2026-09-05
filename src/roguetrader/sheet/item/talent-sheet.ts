import { talentCategories } from "../../registry";
import { effectActions, effectEditorChoices } from "./effect-actions";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Single-section talent sheet (no tabs): header + data + description in one
 * scrollable element. All fields degrade to read-only HTML when the sheet is
 * not editable ({{#if editable}} in the templates).
 */
export class TalentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "talent"],
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
				"systems/rogue-trader/template/sheet/item/parts/talent-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		context.categoryChoices = Object.fromEntries(talentCategories.entries());
		// Read-only display label for the category select.
		context.categoryLabel = game.i18n.localize(
			talentCategories.choices[
				this.document.system.category
			] as string,
		);
		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) => game.i18n.localize(key)));
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