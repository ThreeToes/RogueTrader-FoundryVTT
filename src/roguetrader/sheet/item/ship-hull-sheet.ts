import { effectActions } from "./effect-actions";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ship hull sheet (bead 5lbn follow-up, owner ask): single-section sheet for
 * the `ship` document type (starship hulls — player-buildable classes and
 * npc:true vessels). Shows the full hull statline plus the pre-installed
 * component lists (essential/supplemental/complications, read-only — the
 * ship creator instantiates them by name with loud failures).
 */
export class ShipHullSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "ship-hull",
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
				"systems/rogue-trader/template/sheet/item/parts/ship-hull-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const sys = this.document.system as unknown as Record<string, unknown> & {
			npc?: boolean;
			essentialComponents?: string[];
			supplementalComponents?: string[];
			complications?: string[];
			specialRules?: string;
			hullClass?: string;
		};
		// Component lists are authoring-time references (gjn6): the ship
		// creator instantiates them by name; show them read-only here.
		context.isNpc = sys.npc === true;
		context.essentialComponents = sys.essentialComponents ?? [];
		context.supplementalComponents = sys.supplementalComponents ?? [];
		context.complications = sys.complications ?? [];
		context.specialRulesHTML =
			await enrichText(
				String(sys.specialRules ?? ""),
				this.document,
				{ secrets: this.document.isOwner },
			);
		context.descriptionHTML =
			await enrichText(
				String(this.document.system.description ?? ""),
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}