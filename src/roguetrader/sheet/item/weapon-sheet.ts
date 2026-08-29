import { RangedWeapon } from "../../data/item/ranged-weapon";
import {
	MELEE_CLASSES,
	RANGED_CLASSES,
	WeaponClass,
} from "../../data/item/weapon-class";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class WeaponSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "weapon"],
		position: { width: 500, height: 500 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		data: {
			template: "systems/rogue-trader/template/sheet/item/tabs/weapon-data.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.DATA" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system;

		// Class choices already restricted per weapon type at the schema level;
		// the dropdown mirrors the schema restriction.
		const classes: WeaponClass[] =
			this.document.type === "melee-weapon" ? MELEE_CLASSES : RANGED_CLASSES;
		context.classChoices = Object.fromEntries(
			classes.map((value) => [value, `CLASS.${value.toUpperCase()}`]),
		);

		context.isRanged = this.document.type === "ranged-weapon";
		context.isMelee = this.document.type === "melee-weapon";

		// Normalized rate of fire record so all fields exist for ranged weapons.
		context.rateOfFire = {
			singleShot: system.rateOfFire?.singleShot ?? false,
			burst: system.rateOfFire?.burst ?? 0,
			fullAuto: system.rateOfFire?.fullAuto ?? 0,
		};

		return context;
	}
}
