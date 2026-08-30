import { talents } from "../../registry";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Minimal talent picker: lists the talent registry (CONFIG.ROGUE_TRADER
 * .talents) and grants selected talents as owned `talent` items. Reuses the
 * skill-picker anatomy and styling; owned talents appear in the inventory tab.
 */
export class TalentPicker extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-talent-picker",
		classes: ["rogue-trader", "sheet", "skill-picker"],
		position: { width: 400, height: 460 },
		window: { title: "TALENT.ADD", resizable: true },
		actions: {
			addCatalog: TalentPicker.#addCatalog,
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
				"systems/rogue-trader/template/sheet/actor/parts/talent-picker.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = (await super._prepareContext(_options)) as Record<
			string,
			unknown
		>;
		const owned = new Set(
			this.actor.items
				.filter((item) => item.type === "talent")
				.map((item) => item.name),
		);
		// NOTE(prereqs): per-entry prerequisite gating (Talent.canGrant) activates
		// once the registry carries per-entry metadata (key -> {label, prereq} instead
		// of key -> label only); the base seed defines no chains, so all entries grant.
		context.catalog = talents
			.entries()
			.map(([key, labelKey]) => ({
				key,
				name: game.i18n.localize(labelKey),
				owned: owned.has(game.i18n.localize(labelKey)),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		return context;
	}

	static async #addCatalog(
		this: InstanceType<typeof TalentPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key || !this.actor) return;
		const labelKey = talents.get(key);
		if (!labelKey) return;
		const name = game.i18n.localize(labelKey);
		// Idempotent grant: one talent item per registry key per actor.
		if (
			this.actor.items.find(
				(item) => item.type === "talent" && item.name === name,
			)
		) {
			return;
		}
		await this.actor.createEmbeddedDocuments("Item", [
			{ name, type: "talent", system: {} },
		]);
		this.render({ force: true });
	}
}