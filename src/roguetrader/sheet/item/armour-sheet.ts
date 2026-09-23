import { Armour } from "../../data/item/armour";
import { Battlesuit } from "../../data/item/battlesuit";
import { bodyLocations } from "../../registry";
import { effectActions, effectEditorChoices } from "./effect-actions";
import { ITEM_DATA_TABS } from "../tabs";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class ArmourSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "armour",
		width: 500,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		data: {
			template: "systems/rogue-trader/template/sheet/item/tabs/armour-data.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as Armour;

		// Complete per-location record so every registry location shows a box.
		context.armourPoints = Object.fromEntries(
			bodyLocations
				.keys()
				.map((location) => [location, system.armourPoints[location] ?? 0]),
		);

		// Explicit row membership so template order cannot be re-ordered by
		// config iteration order (head / left arm | body | right arm / legs, bead tr4).
		const row = (locations: string[], cssClass?: string) => ({
			cssClass,
			parts: locations.map((location) => ({
				location,
				label: bodyLocations.get(location) ?? location,
			})),
		});
		context.armourRows = [
			row(["head"], "head"),
			row(["left-arm", "body", "right-arm"]),
			row(["left-leg", "right-leg"], "legs-row"),
		];

		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) => game.i18n.localize(key)));

		// Tau battlesuits (bead rojm) share this sheet and add the profile block
		// the book prints on p38: Hard Points, Size, Strength, Primary Systems and
		// a Recommended Loadout. Exposed only for that type, so plain armour
		// renders exactly as before.
		if (this.document.type === "battlesuit") {
			const suit = system as Battlesuit;
			context.battlesuit = {
				hardPoints: suit.hardPoints,
				size: suit.size,
				strength: suit.strength,
				// Arrays are edited as one comma-separated line: the book lists both
				// as prose enumerations ("Blacksun filters, enhanced motive
				// systems, ..."), so a joined string is the honest editor.
				primarySystems: (suit.primarySystems ?? []).join(", "),
				recommendedLoadout: (suit.recommendedLoadout ?? []).join(", "),
				specialRules: suit.specialRules ?? "",
			};
		}

		// Description tab: enriched HTML from the system description
		// (WeaponSheet/ArmourSheet don't extend GearSheet, which computes this).
		context.descriptionHTML =
			await enrichText(
				this.document.system.description,
				this.document,
				{ secrets: this.document.isOwner },
			);
		return context;
	}
}
