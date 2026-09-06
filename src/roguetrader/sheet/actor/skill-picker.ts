import { CHARACTERISTIC_KEYS, Character } from "../../data/actor/character";
import { sheetContext } from "../context";
import { getPackDocuments } from "../pack-resolve";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Minimal skill picker: lists the catalog from the skills compendium pack and
 * lets the user create custom specializations. Owned skills appear on the
 * character sheet's skills tab.
 */
export class SkillPicker extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-skill-picker",
		classes: ["rogue-trader", "sheet", "skill-picker"],
		position: { width: 400, height: 500 },
		window: { title: "SKILL.ADD", resizable: true },
		actions: {
			addCatalog: SkillPicker.#addCatalog,
			addCustom: SkillPicker.#addCustom,
		},
	};

	actor: foundry.documents.Actor;

	constructor(options: { actor: foundry.documents.Actor } & object) {
		super(options);
		this.actor = options.actor;
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/skill-picker.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options));
		const catalog: Array<{ id: string; name: string; characteristic: string }> =
			[];
		const documents = (await getPackDocuments(
			"rogue-trader.skills",
		)) as foundry.documents.Item[];
		for (const doc of documents) {
			catalog.push({
				id: doc.id,
				name: doc.name ?? doc.id,
				characteristic:
					(doc.system as { characteristic?: string }).characteristic ?? "int",
			});
		}
		catalog.sort((a, b) => a.name.localeCompare(b.name));

		const owned = new Set(
			this.actor.items
				.filter((item) => item.type === "skill")
				.map((item) => item.name),
		);
		context.catalog = catalog.map((entry) => ({
			...entry,
			owned: owned.has(entry.name),
			charLabel: `CHARACTERISTIC.${entry.characteristic.toUpperCase()}`,
		}));
		context.characteristicChoices = Object.fromEntries(
			CHARACTERISTIC_KEYS.map((key) => [
				key,
				`CHARACTERISTIC.${key.toUpperCase()}`,
			]),
		);
		return context;
	}

	static async #addCatalog(
		this: InstanceType<typeof SkillPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		if (!name || !this.actor) return;
		const documents = (await getPackDocuments(
			"rogue-trader.skills",
		)) as foundry.documents.Item[];
		const source = documents.find((doc) => doc.name === name);
		if (!source) return;
		await this.actor.createEmbeddedDocuments("Item", [source.toObject()]);
		this.render({ force: false });
	}

	static async #addCustom(
		this: SkillPicker,
		_event: unknown,
		form: HTMLFormElement,
	): Promise<void> {
		const skillName = new FormData(form).get("name") as string | null;
		const characteristic = new FormData(form).get("characteristic") as
			| string
			| null;
		if (!skillName || !characteristic) return;
		await this.actor.createEmbeddedDocuments("Item", [
			{
				name: skillName,
				type: "skill",
				system: { characteristic, ladder: 1 },
			},
		]);
		this.render({ force: false });
	}
}
