import { effectActions } from "./effect-actions";
import { itemDescriptionHTML } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Combat action sheet (bead moew): read-mostly sheet for the `action` type —
 * one row of Table 9-4: Combat Actions plus its printed Action Descriptions
 * prose. Shows the printed type/subtypes, prerequisites and the printed test
 * spec, then the full verbatim prose.
 */
export class ActionSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "action",
		width: 520,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/action-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const sys = this.document.system as unknown as Record<string, unknown>;
		const roll = (sys.roll ?? {}) as Record<string, unknown>;
		// Optional stat-block lines, shown only when authored: the Varies
		// note, the printed table columns, then the printed roll spec.
		const columns = (
			[
				["actionNote", "ACTION.NOTE"],
				["actionCost", "ACTION.COST"],
				["subtypes", "ACTION.SUBTYPES"],
				["prerequisites", "ACTION.PREREQUISITES"],
				["roll.test", "ACTION.TEST"],
				["roll.difficulty", "ACTION.DIFFICULTY"],
			] as Array<[string, string]>
		)
			.map(([key, labelKey]) => {
				const [root, leaf] = key.split(".");
				const value = leaf
						? String(roll[leaf] ?? "")
						: String(sys[root] ?? "");
				return {
					// Foundry input name: dotted form path into system.*
					name: `system.${key}`,
					label: game.i18n.localize(labelKey),
					value,
				};
			})
			.filter((c) => c.value !== "" && c.value !== "0");
		context.columns = columns;
		context.descriptionHTML = await itemDescriptionHTML(this.document);
		return context;
	}
}