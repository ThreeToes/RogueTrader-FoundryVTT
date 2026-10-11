const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { effectActions } from "./effect-actions";
import { ITEM_DATA_TABS } from "../tabs";
import { damageTypes } from "../../registry";
import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

export class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "gear",
		width: 500,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		tabs: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/tabs.hbs`,
		},
		data: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/data.hbs`,
		},
		notes: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/notes.hbs`,
		},
	};

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));

		// Context.tabs is a flat record keyed by tab id: { data: {...}, notes: {...} }.
		context.tabs = this._prepareTabs("primary");

		// Tau battlesuit systems (bead i0dc) share this sheet: expose the category
		// and the Hard Point cost the suit's budget is spent on. Guarded so plain
		// gear renders exactly as before.
		if (this.document.type === "battlesuit-system") {
			const system = this.document.system as {
				category?: string;
				hardPointCost?: number;
			};
			context.battlesuitSystem = {
				category: foundry.utils.getProperty(this.document, "system.category"),
				hardPointCost: system.hardPointCost ?? 0,
			};
		}

		// Launcher ordnance block (bead 4obp): read-only display of the fire
		// profile the launching weapon derives when this ammunition is loaded.
		// Plain ammunition (no block) renders exactly as before.
		if (this.document.type === "ammunition") {
			const system = this.document.system as unknown as {
				ordnance?: {
					kind?: string;
					damage?: string;
					damageType?: string;
					penetration?: number;
					qualities?: string[];
				};
			};
			if (system.ordnance?.damage) {
				context.ordnance = {
					kind: system.ordnance.kind ?? "",
					damage: system.ordnance.damage,
					damageType: system.ordnance.damageType ?? "",
					penetration: system.ordnance.penetration ?? 0,
					qualities: (system.ordnance.qualities ?? []).map(String),
				};
			}
			// Damage type choices (bead seeg): ONE registry seed shared by every
			// sheet — keys match the stored enum values.
			context.damageTypeChoices = damageTypes.choices;
		}

		// Item data keys (bead apxq): effect editor choices (bead bpd, localized
		// kind labels + test keys) + the enriched description tab prose.
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}
