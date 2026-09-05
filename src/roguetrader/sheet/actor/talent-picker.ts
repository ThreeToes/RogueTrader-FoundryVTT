import { talents } from "../../registry";
import {
	evaluatePrerequisites,
	parsePrerequisites,
} from "../../rules/prereq";
import { talentGrant, promptParameterisedSubject } from "./grant-helpers";
import { parameterisedBase } from "../../rules/grants";

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
		let name = game.i18n.localize(labelKey);
		// yclz: parameterised talents ("Peer", "Enemy"...) prompt for their
		// subject; a bare "Peer" is mechanically meaningless. Cancelled
						// prompt = no grant.
		if (parameterisedBase(name)) {
			const prompted = await promptParameterisedSubject(name);
			if (prompted === null) return;
			name = prompted;
		}
		// Idempotent grant: one talent item per resolved name per actor.
		if (
			this.actor.items.find(
				(item) => item.type === "talent" && item.name === name,
			)
		) {
			return;
		}
		// Soft prereq enforcement (bead tfk): evaluate the pack talent's
		// "Prerequisites: ..." description line; unmet prereqs confirm-dialog
		// (GM overridable), never a hard block.
		const doc = await TalentPicker.#findPackTalent(name);
		const prereqText = doc?.prereqText ?? "";
		if (prereqText) {
			const parsed = parsePrerequisites(prereqText);
			const snapshot = this.#actorSnapshot();
			const { unmet } = evaluatePrerequisites(parsed, snapshot);
			if (unmet.length > 0) {
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: game.i18n.localize("PREREQ.CONFIRM_TITLE") },
					content: `<p>${game.i18n.format("PREREQ.CONFIRM_HINT", { name })}</p><ul>${unmet.map((u) => `<li>${u}</li>`).join("")}</ul>`,
				});
				if (!confirmed) return;
			}
		}
		// meh0: clone the pack document so granted talents carry description,
		// category and effects (bare fallback with a console note inside).
		const payload = await talentGrant(name);
		await this.actor.createEmbeddedDocuments("Item", [payload] as never);
		this.render({ force: true });
	}

	/** Pack document for a talent name (prereq text lives in its description). */
	static async #findPackTalent(
		name: string,
	): Promise<{ prereqText: string } | null> {
		const pack = game.packs?.get("rogue-trader.talents");
		if (!pack) return null;
		const docs = (await pack.getDocuments()) as unknown as Array<{
			name?: string;
			system: { description?: string };
		}>;
		const doc = docs.find((d) => d.name === name);
		if (!doc?.system.description) return null;
		const match = /^Prerequisites:\s*([^.]*)/i.exec(doc.system.description);
		return { prereqText: match?.[1]?.trim() ?? "" };
	}

	#actorSnapshot() {
		const system = this.actor.system as unknown as {
			characteristics: Record<string, { value: number }>;
			psyRating?: number;
		};
		return {
			characteristics: Object.fromEntries(
				Object.entries(system.characteristics ?? {}).map(([k, v]) => [
					k,
					v.value,
				]),
			),
			talents: this.actor.items
				.filter((item) => item.type === "talent")
				.map((item) => item.name ?? ""),
			psyRating: system.psyRating ?? 0,
		};
	}
}
