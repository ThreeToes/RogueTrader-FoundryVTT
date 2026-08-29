import { Gear } from "../data/item/gear";
import { GearSheet } from "./item/gear-sheet";
import { registerConfigHelper } from "./handlebars";

export function sheetInit() {
	Hooks.once("init", () => {
		CONFIG.Item.dataModels.gear = Gear;
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
