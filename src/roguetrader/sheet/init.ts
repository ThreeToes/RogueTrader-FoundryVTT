import { Armour } from "../data/item/armour";
import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { attachRegistriesToConfig } from "../registry";
import { registerConfigHelper } from "./handlebars";
import { ArmourSheet } from "./item/armour-sheet";
import { GearSheet } from "./item/gear-sheet";
import { WeaponSheet } from "./item/weapon-sheet";

// biome-ignore lint/suspicious/noExplicitAny: AppV2 sheet classes pass typing
// checks at runtime but the bundled foundry typings flag them.
type AnySheetCtor = new (...args: unknown[]) => object;

export function sheetInit() {
	Hooks.once("init", () => {
		attachRegistriesToConfig();

		CONFIG.Item.dataModels.gear = Gear;
		CONFIG.Item.dataModels["ranged-weapon"] = RangedWeapon;
		CONFIG.Item.dataModels["melee-weapon"] = MeleeWeapon;
		CONFIG.Item.dataModels.armour = Armour;
		registerConfigHelper();

		const registerItemSheet = (
			sheet: AnySheetCtor,
			types: [string, ...string[]],
			label: string,
		) => {
			foundry.applications.apps.DocumentSheetConfig.registerSheet(
				foundry.documents.Item,
				game.system?.id ?? "rogue-trader",
				sheet as never,
				{
					types,
					makeDefault: true,
					label,
				},
			);
		};

		registerItemSheet(
			GearSheet as unknown as AnySheetCtor,
			["gear"],
			"ROGUE_TRADER.GEAR.SHEET",
		);
		registerItemSheet(
			WeaponSheet as unknown as AnySheetCtor,
			["ranged-weapon", "melee-weapon"],
			"ROGUE_TRADER.WEAPON.SHEET",
		);
		registerItemSheet(
			ArmourSheet as unknown as AnySheetCtor,
			["armour"],
			"ROGUE_TRADER.ARMOUR.SHEET",
		);
	});
}
