import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { GearSheet } from "./item/gear-sheet";
import { registerConfigHelper } from "./handlebars";

export function sheetInit() {
	Hooks.once("init", () => {
		CONFIG.Item.dataModels.gear = Gear;
		CONFIG.Item.dataModels["ranged-weapon"] = RangedWeapon;
		CONFIG.Item.dataModels["melee-weapon"] = MeleeWeapon;
		registerConfigHelper();

		foundry.applications.apps.DocumentSheetConfig.registerSheet(
			foundry.documents.Item,
			game.system.id,
			GearSheet,
			{
				types: ["gear"],
				makeDefault: true,
				label: "ROGUE_TRADER.GEAR.SHEET",
			},
		);
	});
}
