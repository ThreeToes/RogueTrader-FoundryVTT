import { WARRANT_ROW_LABEL_KEYS } from "../../rules/warrant";
import { itemDescriptionHTML } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Warrant option sheet (bead 3cb1): read-only reference sheet for the
 * `warrant-option` type — the Ship & Warrant Path chart options (Into the
 * Storm Chapter I, printed pp33-44) the Warrant creator and Dynasty sheet
 * consume from the compendium. Shows the chart row + column, the derived
 * starting Ship Points / Profit Factor, the machine-inapplicable mechanics
 * notes and the verbatim book prose.
 *
 * These are compendium reference documents, so everything is presented as
 * static values; the description keeps the standard editable-aware
 * prose-mirror branch so an imported copy can still be annotated.
 */
export class WarrantOptionSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "warrant-option",
		width: 560,
		height: "auto",
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/warrant-option-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const localize = (key: string) => game.i18n.localize(key);
		const sys = this.document.system as unknown as {
			row?: string;
			col?: number;
			mechanics?: {
				shipPoints?: number;
				profitFactor?: number;
				notes?: string[];
			};
		};
		const row = String(sys.row ?? "");
		context.rowLabel = localize(WARRANT_ROW_LABEL_KEYS[row] ?? row);
		context.col = Number(sys.col ?? 0);
		const mechanics = sys.mechanics ?? {};
		context.shipPoints = Number(mechanics.shipPoints ?? 0);
		context.profitFactor = Number(mechanics.profitFactor ?? 0);
		context.notes = [...(mechanics.notes ?? [])];
		context.descriptionHTML = await itemDescriptionHTML(this.document);
		return context;
	}
}