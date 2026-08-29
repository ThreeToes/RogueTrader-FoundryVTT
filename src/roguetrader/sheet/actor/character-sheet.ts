import { Character } from "../../data/actor/character";
import { rollSkill, rollSkillUntrained, rollTest } from "../../rules/adapter";
import { defaultSkillItems } from "../../rules/default-skills";
import { getSkillCatalog } from "./skill-catalog";
import { SkillPicker } from "./skill-picker";

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
		actions: {
			rollTest: CharacterSheet.#onRollTest,
			rollSkill: CharacterSheet.#onRollSkill,
			rollUntrained: CharacterSheet.#onRollUntrained,
			ownSkill: CharacterSheet.#onOwnSkill,
			addSkill: CharacterSheet.#onAddSkill,
			setLadder: CharacterSheet.#onSetLadder,
			deleteSkill: CharacterSheet.#onDeleteSkill,
		},
	};

	/**
	 * Click a characteristic to roll it.
	 */
	static async #onRollTest(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key) return;
		await rollTest(this.actor, key, { skipDialog: false });
	}

	static async #onRollSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await rollSkill(this.actor, itemId, { skipDialog: false });
	}

	static async #onRollUntrained(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const key = target.dataset.characteristic;
		if (!name || !key) return;
		await rollSkillUntrained(this.actor, name, key);
	}

	/** Lazy-own: create the catalog skill item at the requested ladder. */
	static async #onOwnSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const characteristic = target.dataset.characteristic;
		const ladder = Number(target.dataset.ladder);
		if (!name || !characteristic || Number.isNaN(ladder)) return;
		await this.actor.createEmbeddedDocuments("Item", [
			{ name, type: "skill", system: { characteristic, ladder } },
		]);
	}

	static async #onAddSkill(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new SkillPicker({ actor: this.actor }).render({ force: true });
	}

	static async #onSetLadder(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		const value = Number(target.dataset.value);
		if (!itemId || Number.isNaN(value)) return;
		await this.actor.items.get(itemId)?.update({ system: { ladder: value } });
	}

	static async #onDeleteSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}

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
		skills: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/skills.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.STATS" },
				{ id: "skills", group: "primary", label: "TAB.SKILLS" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	/**
	 * Lazy default-skill backfill: a pc/npc opened with zero skills receives
	 * the catalog's common skills. Belt-and-braces with the createActor hook:
	 * both paths use the same pure grant and are guarded to no-op once any
	 * item exists. Covers actors created before the feature existed.
	 */
	async #ensureDefaultSkills(): Promise<void> {
		if (this.actor.items.size > 0) return;
		if (this.actor.type !== "pc" && this.actor.type !== "npc") return;
		const pack = game.packs.get("rogue-trader.skills");
		if (!pack) return;
		const documents = (await pack.getDocuments()) as foundry.documents.Item[];
		const grants = defaultSkillItems(
			documents.map(
				(doc) =>
					doc.toObject() as {
						type: string;
						name: string;
						system: {
							common?: boolean;
							characteristic: string;
							ladder: number;
						};
					},
			),
		);
		if (grants.length === 0 || this.actor.items.size > 0) return;
		await this.actor.createEmbeddedDocuments("Item", grants);
	}

	async _prepareContext(options: { isFirstRender: boolean }) {
		await this.#ensureDefaultSkills();
		const context = (await super._prepareContext(options)) as Record<
			string,
			unknown
		>;
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

		const ownedSkills = this.actor.items.filter(
			(item) => item.type === "skill",
		);
		const ladderOptions = [
			{ value: 1, label: "SKILL.LADDER_KNOWN" },
			{ value: 2, label: "SKILL.LADDER_PLUS_10" },
			{ value: 3, label: "SKILL.LADDER_PLUS_20" },
		];
		const catalog = await getSkillCatalog();
		const ownedNames = new Set(ownedSkills.map((item) => item.name));
		const catalogByChar = new Map<
			string,
			Awaited<ReturnType<typeof getSkillCatalog>>
		>();
		for (const entry of catalog) {
			const list = catalogByChar.get(entry.characteristic) ?? [];
			list.push(entry);
			catalogByChar.set(entry.characteristic, list);
		}

		context.skillGroups = Object.keys(
			(system.characteristics ?? {}) as Record<string, unknown>,
		).map((key) => {
			const label = `CHARACTERISTIC.${key.toUpperCase()}`;
			const rows = ownedSkills
				.filter(
					(item) =>
						(item.system as unknown as { characteristic: string })
							.characteristic === key,
				)
				.map((item) => ({
					owned: true,
					id: item.id,
					name: item.name,
					advanced:
						(item.system as unknown as { advanced?: boolean }).advanced ===
						true,
					ladder: (item.system as unknown as { ladder: number }).ladder,
					ladderOptions,
				}));
			for (const entry of catalogByChar.get(key) ?? []) {
				if (ownedNames.has(entry.name)) continue;
				rows.push({
					owned: false,
					id: entry.id,
					name: entry.name,
					advanced: entry.advanced,
					ladder: 0,
					ladderOptions,
				});
			}
			rows.sort((a, b) => a.name.localeCompare(b.name));
			return { key, label, skills: rows };
		});

		context.isPC = this.actor.type === "pc";
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(system.description, {
				secrets: this.actor.isOwner,
				relativeTo: this.actor,
			});

		return context;
	}
}
