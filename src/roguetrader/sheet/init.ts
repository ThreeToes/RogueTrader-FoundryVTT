import { Character } from "../data/actor/character";
import { Vehicle } from "../data/actor/vehicle";
import { Armour } from "../data/item/armour";
import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { Skill } from "../data/item/skill";
import { Talent } from "../data/item/talent";
import { attachRegistriesToConfig } from "../registry";
import { rollSkill, rollTest } from "../rules/adapter";
import { testContributors } from "../rules/funnel";
import { defaultSkillItems } from "../rules/default-skills";
import { CharacterSheet } from "./actor/character-sheet";
import { VehicleSheet } from "./actor/vehicle-sheet";
import { registerConfigHelper } from "./handlebars";
import { ArmourSheet } from "./item/armour-sheet";
import { GearSheet } from "./item/gear-sheet";
import { SkillSheet } from "./item/skill-sheet";
import { TalentSheet } from "./item/talent-sheet";
import { WeaponSheet } from "./item/weapon-sheet";

type AnySheetCtor = new (...args: unknown[]) => object;

let commonSkillCatalog: object[] = [];

export function sheetInit() {
	Hooks.once("init", () => {
		attachRegistriesToConfig();

		// Public roll API for modules/macros: game.rogueTrader.rollTest(actor, key, opts)
		const git = game as unknown as { rogueTrader?: Record<string, unknown> };
		git.rogueTrader ??= {};
		git.rogueTrader.rollTest = rollTest;
		git.rogueTrader.rollSkill = rollSkill;

		// Module extension point for test modifiers (funnel v2, see rules/funnel.ts).
		const rtc = CONFIG as unknown as {
			ROGUE_TRADER?: {
				testContributors?: typeof testContributors;
			};
		};
		rtc.ROGUE_TRADER ??= {};
		rtc.ROGUE_TRADER.testContributors = testContributors;

		CONFIG.Item.dataModels.gear = Gear;
		CONFIG.Item.dataModels["ranged-weapon"] = RangedWeapon;
		CONFIG.Item.dataModels["melee-weapon"] = MeleeWeapon;
		CONFIG.Item.dataModels.armour = Armour;
		CONFIG.Item.dataModels.skill = Skill;
		CONFIG.Item.dataModels.talent = Talent;
		CONFIG.Actor.dataModels.pc = Character;
		CONFIG.Actor.dataModels.npc = Character;
		CONFIG.Actor.dataModels.vehicle = Vehicle;
		registerConfigHelper();

		const registerSheet = (
			documentClass:
				| typeof foundry.documents.Item
				| typeof foundry.documents.Actor,
			sheet: AnySheetCtor,
			types: [string, ...string[]],
			label: string,
		) => {
			foundry.applications.apps.DocumentSheetConfig.registerSheet(
				documentClass,
				game.system?.id ?? "rogue-trader",
				sheet as never,
				{
					types,
					makeDefault: true,
					label,
				},
			);
		};

		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			["gear"],
			"ROGUE_TRADER.GEAR.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			WeaponSheet as unknown as AnySheetCtor,
			["ranged-weapon", "melee-weapon"],
			"ROGUE_TRADER.WEAPON.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			ArmourSheet as unknown as AnySheetCtor,
			["armour"],
			"ROGUE_TRADER.ARMOUR.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			SkillSheet as unknown as AnySheetCtor,
			["skill"],
			"ROGUE_TRADER.SKILL.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			TalentSheet as unknown as AnySheetCtor,
			["talent"],
			"ROGUE_TRADER.TALENT.SHEET",
		);

		// Pre-warm the skills pack for the createActor grant hook (the sheet
		// backfill path loads the pack on demand and does not need this cache).
		Hooks.once("ready", () => {
			const pack = game.packs.get("rogue-trader.skills");
			if (!pack) return;
			pack.getDocuments().then((docs) => {
				commonSkillCatalog = docs.map(
					(doc) =>
						doc.toObject() as {
							type: string;
							name: string;
							system: {
								common?: boolean;
								characteristic: string;
								ladder: number;
							};
						},
				);
			});
		});

		Hooks.on("createActor", async (actor, _options, userId) => {
			// Only the creating user embeds the grants (avoids double-fire).
			if (userId !== (game as { userId?: string }).userId) return;
			if (actor.type !== "pc" && actor.type !== "npc") return;
			// Only brand-new blank actors: NPC statblocks and compendium imports
			// come with items and must not receive defaults.
			if (actor.items.size > 0) return;
			if (commonSkillCatalog.length === 0) return;
			await actor.createEmbeddedDocuments(
				"Item",
				defaultSkillItems(commonSkillCatalog),
			);
		});
		registerSheet(
			foundry.documents.Actor,
			CharacterSheet as unknown as AnySheetCtor,
			["pc", "npc"],
			"ROGUE_TRADER.CHARACTER.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			VehicleSheet as unknown as AnySheetCtor,
			["vehicle"],
			"ROGUE_TRADER.VEHICLE.SHEET",
		);
	});
}
