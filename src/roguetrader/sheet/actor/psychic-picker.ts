const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

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
		const context = (await super._prepareContext(
			_options as never,
		)) as Record<string, unknown>;
		const pack = game.packs?.get("rogue-trader.psychicpowers");
		const powers: Array<{
			uuid: string;
			name: string;
			powerClass: string;
			subtype: string;
			subtypeLabel: string;
			owned: boolean;
		}> = [];
		if (pack) {
			const documents = (await pack.getDocuments()) as unknown as Array<{
				uuid?: string;
				name?: string;
				system: { powerClass?: string; subtype?: string };
			}>;
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
		context.hasPack = Boolean(pack);
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