import { effectActions } from "./effect-actions";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ship complication sheet (bead 5lbn follow-up): single-section sheet for
 * the `ship-complication` type — kind (Machine Spirit Oddity / Past
 * History), roll, and the verbatim effect text. Read-only branches match
 * the other item sheets.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
	"machine-spirit-oddity": "STARSHIP.ODDITY",
	"past-history": "STARSHIP.HISTORY",
};

export class ShipComplicationSheet extends HandlebarsApplicationMixin(
	ItemSheetV2,
) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "ship-complication",
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
				"systems/rogue-trader/template/sheet/item/parts/ship-complication-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const sys = this.document.system as unknown as Record<string, unknown> & {
			kind?: string;
			roll?: number;
			effect?: string;
		};
		const kind = String(sys.kind ?? "past-history");
		context.kindLabel = game.i18n.localize(KIND_LABELS[kind] ?? kind);
		context.kindChoices = Object.entries(KIND_LABELS).map(([value, key]) => ({
			value,
			label: game.i18n.localize(key),
		}));
		context.effectHTML =
			await enrichText(
				String(sys.effect ?? ""),
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}