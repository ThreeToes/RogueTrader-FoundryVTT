import { Skill } from "../../data/item/skill";
import { LADDER_OPTIONS } from "../skills-domain";
import { sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class SkillSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "skill",
		width: 420,
		height: 260,
	});

	static PARTS = {
		form: {
			template: "systems/rogue-trader/template/sheet/item/skill.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		context.characteristicChoices = Skill.characteristicChoices;
		context.ladderOptions = LADDER_OPTIONS;
		// Read-only display labels keyed by ladder value.
		context.ladderLabels = Object.fromEntries(
			(context.ladderOptions as Array<{ value: number; label: string }>).map(
				(o) => [o.value, game.i18n.localize(o.label)],
			),
		);
		return context;
	}
}
