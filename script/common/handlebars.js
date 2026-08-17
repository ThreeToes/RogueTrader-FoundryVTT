export const initializeHandlebars = () => {
	registerHandlebarsHelpers();
	preloadHandlebarsTemplates();
};

/**
 * Define a set of template paths to pre-load. Pre-loaded templates are compiled and cached for fast access when
 * rendering. These paths will also be available as Handlebars partials by using the file name.
 * @returns {Promise}
 */
function preloadHandlebarsTemplates() {
	const templatePaths = [
		"systems/rogue-trader/template/sheet/actor/acolyte.hbs",
		"systems/rogue-trader/template/sheet/actor/npc.hbs",
		"systems/rogue-trader/template/sheet/actor/limited-sheet.hbs",

		"systems/rogue-trader/template/sheet/actor/tab/abilities.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/combat.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/gear.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/notes.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/npc-notes.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/npc-stats.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/progression.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/psychic-powers.hbs",
		"systems/rogue-trader/template/sheet/actor/tab/stats.hbs",

		"systems/rogue-trader/template/sheet/mental-disorder.hbs",
		"systems/rogue-trader/template/sheet/aptitude.hbs",
		"systems/rogue-trader/template/sheet/malignancy.hbs",
		"systems/rogue-trader/template/sheet/mutation.hbs",
		"systems/rogue-trader/template/sheet/talent.hbs",
		"systems/rogue-trader/template/sheet/trait.hbs",
		"systems/rogue-trader/template/sheet/special-ability.hbs",
		"systems/rogue-trader/template/sheet/psychic-power.hbs",
		"systems/rogue-trader/template/sheet/critical-injury.hbs",
		"systems/rogue-trader/template/sheet/weapon.hbs",
		"systems/rogue-trader/template/sheet/armour.hbs",
		"systems/rogue-trader/template/sheet/gear.hbs",
		"systems/rogue-trader/template/sheet/drug.hbs",
		"systems/rogue-trader/template/sheet/tool.hbs",
		"systems/rogue-trader/template/sheet/cybernetic.hbs",
		"systems/rogue-trader/template/sheet/weapon-modification.hbs",
		"systems/rogue-trader/template/sheet/ammunition.hbs",
		"systems/rogue-trader/template/sheet/force-field.hbs",
		"systems/rogue-trader/template/sheet/item/parts/effect-part.hbs",
		"systems/rogue-trader/template/sheet/item/parts/effect-tab.hbs",

		"systems/rogue-trader/template/sheet/characteristics/information.hbs",
		"systems/rogue-trader/template/sheet/characteristics/left.hbs",
		"systems/rogue-trader/template/sheet/characteristics/name.hbs",
		"systems/rogue-trader/template/sheet/characteristics/right.hbs",
		"systems/rogue-trader/template/sheet/characteristics/total.hbs",

		"systems/rogue-trader/template/chat/item.hbs",
		"systems/rogue-trader/template/chat/roll.hbs",
		"systems/rogue-trader/template/chat/damage.hbs",
		"systems/rogue-trader/template/chat/critical.hbs",
		"systems/rogue-trader/template/chat/evasion.hbs",
		"systems/rogue-trader/template/chat/emptyMag.hbs",

		"systems/rogue-trader/template/dialog/common-roll.hbs",
		"systems/rogue-trader/template/dialog/combat-roll.hbs",
		"systems/rogue-trader/template/dialog/psychic-power-roll.hbs",
	];
	return foundry.applications.handlebars.loadTemplates(templatePaths);
}

/**
 * Add custom Handlerbars helpers.
 */
function registerHandlebarsHelpers() {
	Handlebars.registerHelper("removeMarkup", function (text) {
		const markup = /<(.*?)>/gi;
		return text.replace(markup, "");
	});

	Handlebars.registerHelper("enrich", function (string) {
		return TextEditor.enrichHTML(string, { async: false });
	});

	Handlebars.registerHelper("damageTypeLong", function (damageType) {
		damageType = (damageType || "i").toLowerCase();
		switch (damageType) {
			case "e":
				return game.i18n.localize("DAMAGE_TYPE.ENERGY");
			case "i":
				return game.i18n.localize("DAMAGE_TYPE.IMPACT");
			case "r":
				return game.i18n.localize("DAMAGE_TYPE.RENDING");
			case "x":
				return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE");
			default:
				return game.i18n.localize("DAMAGE_TYPE.IMPACT");
		}
	});

	Handlebars.registerHelper("damageTypeShort", function (damageType) {
		switch (damageType) {
			case "energy":
				return game.i18n.localize("DAMAGE_TYPE.ENERGY_SHORT");
			case "impact":
				return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
			case "rending":
				return game.i18n.localize("DAMAGE_TYPE.RENDING_SHORT");
			case "explosive":
				return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE_SHORT");
			default:
				return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
		}
	});

	Handlebars.registerHelper("config", function (key) {
		return game.darkHeresy.config[key];
	});
}
