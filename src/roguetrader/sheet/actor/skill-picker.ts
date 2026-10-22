import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { Character } from "../../data/actor/character";
import { characteristics } from "../../registry";
// Bead iktx: the ONE characteristic-label composition seam (labels.ts).
import { characteristicLabelKey } from "../../rules/labels";
import { sheetContext } from "../context";
import { getCharacterOptionDocs } from "../pack-resolve";
import { clonePackDocPayload } from "./creator-apply";
import { findPackDoc, warnPackDocMissing } from "./grant-helpers";
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
			template: `${TEMPLATE_ROOT}sheet/actor/parts/skill-picker.hbs`,
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
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
				characteristicLabelKey(entry.characteristic),
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
		// bead 38io: the shared case-insensitive pack-by-name resolve (was a
		// case-sensitive docs.find() that silently no-opped on a miss).
		const source = (await findPackDoc(
			"skill",
			name,
		)) as foundry.documents.Item | null;
		if (!source) {
			// Bead eqay: the shared warn owns the user-facing notify too — the
			// default error severity (this site used to be console-only).
			warnPackDocMissing("skill", name, "grant skipped");
			return;
		}
		// The clone must not carry the pack doc's _id (two Items cannot share
		// an _id; shared strip via clonePackDocPayload, bead xynx).
		await this.actor.createEmbeddedDocuments("Item", [
			clonePackDocPayload(source.toObject()),
		]);
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
