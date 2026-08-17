// Import our resources
import { DarkHeresyActor } from "./common/actor.js";
import { DarkHeresyItem } from "./common/item.js";
import { AcolyteSheet } from "./sheet/actor/acolyte.js";
import { NpcSheet } from "./sheet/actor/npc.js";
import { WeaponSheet } from "./sheet/weapon.js";
import { AmmunitionSheet } from "./sheet/ammunition.js";
import { WeaponModificationSheet } from "./sheet/weapon-modification.js";
import { ArmourSheet } from "./sheet/armour.js";
import { ForceFieldSheet } from "./sheet/force-field.js";
import { CyberneticSheet } from "./sheet/cybernetic.js";
import { DrugSheet } from "./sheet/drug.js";
import { GearSheet } from "./sheet/gear.js";
import { ToolSheet } from "./sheet/tool.js";
import { CriticalInjurySheet } from "./sheet/critical-injury.js";
import { MalignancySheet } from "./sheet/malignancy.js";
import { MentalDisorderSheet } from "./sheet/mental-disorder.js";
import { MutationSheet } from "./sheet/mutation.js";
import { PsychicPowerSheet } from "./sheet/psychic-power.js";
import { TalentSheet } from "./sheet/talent.js";
import { SpecialAbilitySheet } from "./sheet/special-ability.js";
import { TraitSheet } from "./sheet/trait.js";
import { AptitudeSheet } from "./sheet/aptitude.js";
import { initializeHandlebars } from "./common/handlebars.js";
import { migrateWorld } from "./common/migration.js";
import {
	prepareCommonRoll,
	prepareCombatRoll,
	preparePsychicPowerRoll,
} from "./common/dialog.js";
import { commonRoll, combatRoll } from "./common/roll.js";
import { chatListeners } from "./common/chat.js";
import DhMacroUtil from "./common/macro.js";
import Dh from "./common/config.js";

// Import Helpers
import * as chat from "./common/chat.js";
import { registerDataModels } from "./setup/registerDataModels.js";
import { registerAdditionalModuleSettings } from "./moduleSupport/moduleSupportSettings.js";

Hooks.once("init", function () {
	CONFIG.Combat.initiative = {
		formula: "@initiative.base + @initiative.bonus",
		decimals: 0,
	};
	CONFIG.Actor.documentClass = DarkHeresyActor;
	CONFIG.Item.documentClass = DarkHeresyItem;
	CONFIG.fontDefinitions["Caslon Antique"] = { editor: true, fonts: [] };
	CONFIG.ActiveEffect.legacyTransferral = false;
	game.darkHeresy = {
		config: Dh,
		testInit: {
			prepareCommonRoll,
			prepareCombatRoll,
			preparePsychicPowerRoll,
		},
		tests: {
			commonRoll,
			combatRoll,
		},
	};
	game.macro = DhMacroUtil;
	foundry.documents.collections.Actors.unregisterSheet(
		"core",
		foundry.appv1.sheets.ActorSheet,
	);
	foundry.documents.collections.Actors.registerSheet(
		"rogue-trader",
		AcolyteSheet,
		{
			types: ["acolyte"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Actors.registerSheet("rogue-trader", NpcSheet, {
		types: ["npc"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.unregisterSheet(
		"core",
		foundry.appv1.sheets.ItemSheet,
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		WeaponSheet,
		{
			types: ["weapon"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		AmmunitionSheet,
		{
			types: ["ammunition"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		WeaponModificationSheet,
		{
			types: ["weaponModification"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		ArmourSheet,
		{
			types: ["armour"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		ForceFieldSheet,
		{
			types: ["forceField"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		CyberneticSheet,
		{
			types: ["cybernetic"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet("rogue-trader", DrugSheet, {
		types: ["drug"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("rogue-trader", GearSheet, {
		types: ["gear"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("rogue-trader", ToolSheet, {
		types: ["tool"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		CriticalInjurySheet,
		{
			types: ["criticalInjury"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		MalignancySheet,
		{
			types: ["malignancy"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		MentalDisorderSheet,
		{
			types: ["mentalDisorder"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		MutationSheet,
		{
			types: ["mutation"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		PsychicPowerSheet,
		{
			types: ["psychicPower"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		TalentSheet,
		{
			types: ["talent"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		SpecialAbilitySheet,
		{
			types: ["specialAbility"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		TraitSheet,
		{
			types: ["trait"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"rogue-trader",
		AptitudeSheet,
		{
			types: ["aptitude"],
			makeDefault: true,
		},
	);

	registerDataModels();

	initializeHandlebars();

	game.settings.register("rogue-trader", "worldSchemaVersion", {
		name: "World Version",
		hint: "Used to automatically upgrade worlds data when the system is upgraded.",
		scope: "world",
		config: true,
		default: 0,
		type: Number,
	});
	game.settings.register("rogue-trader", "autoCalcXPCosts", {
		name: "Calculate XP Costs",
		hint: "If enabled, calculate XP costs automatically.",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});
	game.settings.register("rogue-trader", "useSpraytemplate", {
		name: "Use Template with Spray Weapons",
		hint: "If enabled, Spray Weapons will require the user to put down a template before the roll is made. Templates are NOT removed automatically",
		scope: "client",
		config: true,
		default: true,
		type: Boolean,
	});

	registerAdditionalModuleSettings();
});

Hooks.once("ready", function () {
	migrateWorld();
	CONFIG.ChatMessage.documentClass.prototype.getRollData = function () {
		return this.getFlag("rogue-trader", "rollData");
	};
});

/* -------------------------------------------- */
/*  Other Hooks                                 */
/* -------------------------------------------- */

/** Add Event Listeners for Buttons on chat boxes */
Hooks.on("renderChatMessageHTML", (chat, html, context) => {
	chatListeners(html);
});

/** Add Options to context Menu of chatmessages */
Hooks.on("getChatMessageContextOptions", (html, options) =>
	chat.addChatMessageContextOptions(html, options),
);

/**
 * Create a macro when dropping an entity on the hotbar
 * Item      - open roll dialog for item
 */
Hooks.on("hotbarDrop", (bar, data, slot) => {
	if (data.type === "Item" || data.type === "Actor") {
		DhMacroUtil.createMacro(data, slot);
		return false;
	}
});

Hooks.on("renderDarkHeresySheet", (sheet, html, data) => {
	html
		.find("input.cost")
		.prop("disabled", game.settings.get("rogue-trader", "autoCalcXPCosts"));
	html
		.find(":not(.psychic-power) > input.item-cost")
		.prop("disabled", game.settings.get("rogue-trader", "autoCalcXPCosts"));
});
