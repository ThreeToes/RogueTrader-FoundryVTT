const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

import { sheetContext } from "../context";
import { getPackDocuments } from "../pack-resolve";

/**
 * Psychic power compendium picker (bead m4me): lists `rogue-trader.psychicpowers`
 * pack documents and grants them as owned psychicpower items. The pack does
 * not exist yet (extraction bead 5u5) — the picker degrades to a hint until
 * it lands. Mirrors SkillPicker/TalentPicker.
 */
export class PsychicPicker extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-psychic-picker",
		classes: ["rogue-trader", "sheet", "psychic-picker"],
		position: { width: 420, height: 500 },
		window: { title: "PSYCHIC_POWER.PICKER_TITLE", resizable: true },
		actions: {
			addPower: PsychicPicker.#addPower,
		},
	};

	actor: foundry.documents.Actor;

	constructor(options: { actor: foundry.documents.Actor } & object) {
		super(options as never);
		this.actor = options.actor;
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/psychic-picker.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options as never));
		const documents = (await getPackDocuments(
			"rogue-trader.psychicpowers",
		)) as unknown as Array<{
			uuid?: string;
			name?: string;
			system: { powerClass?: string; subtype?: string };
		}>;
		const powers: Array<{
			uuid: string;
			name: string;
			powerClass: string;
			subtype: string;
			subtypeLabel: string;
			owned: boolean;
		}> = [];
		if (documents.length > 0) {
			const owned = new Set(
				this.actor.items
					.filter((item) => (item.type as string) === "psychicpower")
					.map((item) => item.name),
			);
			for (const doc of documents) {
				if (!doc.name) continue;
				const subtype = doc.system.subtype ?? "focus";
				powers.push({
					uuid: doc.uuid ?? "",
					name: doc.name,
					powerClass: doc.system.powerClass ?? "bound",
					subtype,
					subtypeLabel: `PSYCHIC_POWER.${subtype.toUpperCase()}`,
					owned: owned.has(doc.name),
				});
			}
			powers.sort((a, b) => a.name.localeCompare(b.name));
		}
		context.powers = powers;
		// The pack-existence hint degrades to "pack has documents": an installed
		// but empty pack renders the same hint as a missing one.
		context.hasPack = documents.length > 0;
		return context;
	}

	static async #addPower(
		this: InstanceType<typeof PsychicPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid || !this.actor) return;
		const doc = (await foundry.utils.fromUuid(uuid as never)) as unknown as
			| { toObject?: () => object }
			| null;
		if (!doc?.toObject) return;
		await this.actor.createEmbeddedDocuments("Item", [doc.toObject()] as never);
		this.render({ force: true } as never);
	}
}