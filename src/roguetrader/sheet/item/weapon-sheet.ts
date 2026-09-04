import { DamageType } from "../../data/item/damage-types";
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
		position: { width: 520, height: "auto" },
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
				{ id: "notes", group: "primary", label: "TAB.DESCRIPTION" },
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

		// Damage type choices mirror the schema (E/I/R/X book types).
		context.damageTypeChoices = Object.fromEntries(
			Object.values(DamageType).map((value) => [
				value,
				`DAMAGE_TYPE.${value.toUpperCase()}`,
			]),
		);

		// Quality toggle-chips: lookup map so `checked` marks existing picks.
		context.specialFlags = Object.fromEntries(
			(
				(this.document.system as unknown as { special?: string[] }).special ??
				[]
			).map((q) => [q, true]),
		);

		// Normalized rate of fire record so all fields exist for ranged weapons.
		context.rateOfFire = {
			singleShot: system.rateOfFire?.singleShot ?? false,
			burst: system.rateOfFire?.burst ?? 0,
			fullAuto: system.rateOfFire?.fullAuto ?? 0,
		};

		// Description tab: enriched HTML from the system description
		// (WeaponSheet/ArmourSheet don't extend GearSheet, which computes this).
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
