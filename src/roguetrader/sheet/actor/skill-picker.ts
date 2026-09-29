import { Character } from "../../data/actor/character";
import { characteristics } from "../../registry";
import { sheetContext } from "../context";
import { getCharacterOptionDocs } from "../pack-resolve";
import { OwnedItemPicker } from "./owned-picker";

/**
 * Minimal skill picker: lists the catalog from the skills compendium pack and
 * lets the user create custom specializations. Owned skills appear on the
 * character sheet's skills tab.
 */
export class SkillPicker extends OwnedItemPicker {
	static DEFAULT_OPTIONS = OwnedItemPicker.pickerOptions({
		id: "rogue-trader-skill-picker",
		slug: "skill-picker",
		titleKey: "SKILL.ADD",
		width: 400,
		height: 500,
		actions: {
			addCatalog: SkillPicker.#addCatalog,
			addCustom: SkillPicker.#addCustom,
		},
	});

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/skill-picker.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options as never));
		const catalog: Array<{ id: string; name: string; characteristic: string }> =
			[];
		const documents = (await getCharacterOptionDocs(
			"skill",
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

		const owned = this.ownedItemNames("skill");
		context.catalog = catalog.map((entry) => ({
			...entry,
			owned: owned.has(entry.name),
			charLabel:
				characteristics.choices[entry.characteristic] ??
				"CHARACTERISTIC.".concat(entry.characteristic.toUpperCase()),
		}));
		context.characteristicChoices = characteristics.choices;
		return context;
	}

	static async #addCatalog(
		this: InstanceType<typeof SkillPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		if (!name || !this.actor) return;
		const documents = (await getCharacterOptionDocs(
			"skill",
		)) as foundry.documents.Item[];
		const source = documents.find((doc) => doc.name === name);
		if (!source) return;
		await this.actor.createEmbeddedDocuments("Item", [source.toObject()]);
		this.render({ force: false });
	}

	static async #addCustom(
		this: SkillPicker,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		// Foundry hands the element carrying [data-action] — the BUTTON, not the
		// form it sits in — so `new FormData(target)` would throw. Resolve the
		// form from the button.
		const form = target.closest("form");
		if (!(form instanceof HTMLFormElement)) return;
		const data = new FormData(form);
		const skillName = data.get("name") as string | null;
		const characteristic = data.get("characteristic") as string | null;
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
