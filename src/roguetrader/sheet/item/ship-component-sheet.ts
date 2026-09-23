import { effectActions, effectEditorChoices } from "./effect-actions";
import { enrichText } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ship component sheet (bead 5lbn follow-up): single-section sheet for the
 * ship-component / ship-weapon-component types — statline (category,
 * component type, hull types, power, space, SP, availability, weapon stats
 * for weapon components) + special rules + description. All fields degrade
 * to read-only HTML when the sheet is not editable, matching the other
 * item sheets.
 */

/** componentType → sheet label key (shared with the ship creator's labels). */
const TYPE_LABELS: Readonly<Record<string, string>> = {
	"plasma-drive": "SHIP_CREATOR.TYPE_PLASMA_DRIVE",
	"warp-engine": "SHIP_CREATOR.TYPE_WARP_ENGINE",
	"geller-field": "SHIP_CREATOR.TYPE_GELLER_FIELD",
	"void-shield": "SHIP_CREATOR.TYPE_VOID_SHIELD",
	bridge: "SHIP_CREATOR.TYPE_BRIDGE",
	"life-sustainer": "SHIP_CREATOR.TYPE_LIFE_SUSTAINER",
	"crew-quarters": "SHIP_CREATOR.TYPE_CREW_QUARTERS",
	"augur-array": "SHIP_CREATOR.TYPE_AUGUR_ARRAY",
	"macrobattery": "SHIP_COMBAT.MACROBATTERY",
	lance: "SHIP_COMBAT.LANCE",
	"nova-cannon": "STARSHIP.COMPONENTS_NOVA_CANNON",
	"torpedo-tube": "STARSHIP.COMPONENTS_TORPEDO_TUBES",
	"landing-bay": "STARSHIP.COMPONENTS_LANDING_BAYS",
	supplemental: "STARSHIP.COMPONENTS_SUPPLEMENTAL",
	archeotech: "STARSHIP.COMPONENTS_ARCHEOTECH",
	xenotech: "STARSHIP.COMPONENTS_XENOTECH",
};

/** category → localized label (Tables 8-3/8-5/8-6/8-7 headings). */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
	essential: "STARSHIP.COMPONENTS_ESSENTIAL",
	supplemental: "STARSHIP.COMPONENTS_SUPPLEMENTAL",
	archeotech: "STARSHIP.COMPONENTS_ARCHEOTECH",
	xenotech: "STARSHIP.COMPONENTS_XENOTECH",
};

const STATE_LABELS: Readonly<Record<string, string>> = {
	intact: "SHIP_COMPONENT.STATE_INTACT",
	unpowered: "SHIP_COMPONENT.STATE_UNPOWERED",
	damaged: "SHIP_COMPONENT.STATE_DAMAGED",
	destroyed: "SHIP_COMPONENT.STATE_DESTROYED",
};

export class ShipComponentSheet extends HandlebarsApplicationMixin(
	ItemSheetV2,
) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "ship-component",
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
				"systems/rogue-trader/template/sheet/item/parts/ship-component-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const localize = (key: string) => game.i18n.localize(key);
		const sys = this.document.system as unknown as Record<
			string,
			unknown
		> & {
			componentType?: string;
			category?: string;
			space?: number;
			hullTypes?: string;
			power?: string;
			sp?: string;
			availability?: string;
			special?: string;
			state?: string;
			unique?: boolean;
			// weapon-component fields
			strength?: number;
			strengthRoll?: string;
			damage?: string;
			critRating?: number;
			range?: number;
			slot?: string;
		};
		const isWeapon = this.document.type === "ship-weapon-component";
		const componentType = String(sys.componentType ?? "");
		const category = String(sys.category ?? "");
		Object.assign(context, effectEditorChoices(localize));
		context.isWeapon = isWeapon;
		context.typeLabel = localize(TYPE_LABELS[componentType] ?? componentType);
		context.categoryLabel = localize(CATEGORY_LABELS[category] ?? category);
		context.componentTypeChoices = Object.entries(TYPE_LABELS).map(
			([value, key]) => ({ value, label: localize(key) }),
		);
		context.categoryChoices = Object.entries(CATEGORY_LABELS).map(
			([value, key]) => ({ value, label: localize(key) }),
		);
		context.stateChoices = Object.entries(STATE_LABELS).map(
			([value, key]) => ({ value, label: localize(key) }),
		);
		context.stateLabel = localize(STATE_LABELS[String(sys.state ?? "")] ?? "");
		context.specialHTML =
			await enrichText(
				String(sys.special ?? ""),
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