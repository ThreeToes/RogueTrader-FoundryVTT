import { Character } from "../../data/actor/character";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

interface CharacteristicView {
	key: string;
	label: string;
	value: number;
	bonus: number;
	effectiveBonus: number;
	unnatural: number;
}

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "character"],
		position: { width: 600, height: 500 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/actor/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		stats: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/stats.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.STATS" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	async _prepareContext(options: {
		isFirstRender: boolean;
	}) {
		const context = (await super._prepareContext(options)) as Record<string, unknown>;
		const system = this.actor.system as Character;

		context.characteristics = Object.entries(system.characteristics).map(
			([key, data]): CharacteristicView => ({
				key,
				label: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: data.value,
				unnatural: data.unnatural,
				bonus: system.characteristicBonus(key),
				effectiveBonus: system.effectiveCharacteristicBonus(key),
			}),
		);

		context.isPC = this.actor.type === "pc";
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				system.description,
				{
					secrets: this.actor.isOwner,
					relativeTo: this.actor,
				},
			);

		return context;
	}
}
