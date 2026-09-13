import { effectActions } from "./effect-actions";

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
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "ship-hull"],
		position: { width: 520, height: "auto" },
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
			await foundry.applications.ux.TextEditor.enrichHTML(
				String(sys.specialRules ?? ""),
				{ secrets: this.document.isOwner, relativeTo: this.document },
			);
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				String(this.document.system.description ?? ""),
				{ secrets: this.document.isOwner, relativeTo: this.document },
			);
		return context;
	}
}