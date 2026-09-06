import {
	rollNavigatorPower,
	rollPsychicPower,
	rollSkill,
	rollTest,
	rollWeaponAttack,
	rollWeaponDamage,
} from "../../rules/adapter";
import type { Character, CharacteristicKey } from "../../data/actor/character";
import type { CharacteristicKey as Key } from "../../data/actor/character";
import { RtActorSheet } from "../context";
import { npcEquipDefaultSystemOverrides } from "../drop-clone";

/**
 * GM-facing NPC sheet (bead mqdy, owner spec 2026-09-06): fast at-the-table
 * use. Header = name + short description + wounds (current/max) only; a
 * horizontal characteristic table (short row + value row, click to roll);
 * known-or-better skills; combat rolls; tabs for psychic powers (only when
 * the NPC is a psyker/navigator) and long-form notes. The explorer keeps
 * CharacterSheet; this sheet is registered for the npc type only.
 */

/** Short characteristic forms for the table's first row (data model order). */
const CHAR_SHORTS: Record<CharacteristicKey, string> = {
	ws: "WS",
	bs: "BS",
	s: "S",
	t: "T",
	ag: "Ag",
	int: "Int",
	per: "Per",
	wp: "WP",
	fel: "Fel",
};

export class NpcSheet extends RtActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "npc"],
		position: { width: 560, height: 480 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollNpcTest: NpcSheet.#onRollTest,
			rollNpcSkill: NpcSheet.#onRollSkill,
			rollNpcWeapon: NpcSheet.#onRollWeapon,
			rollNpcDamage: NpcSheet.#onRollDamage,
			rollNpcPower: NpcSheet.#onRollPower,
			setNpcLadder: NpcSheet.#onSetLadder,
			deleteNpcSkill: NpcSheet.#onDeleteSkill,
			toggleNpcEquip: NpcSheet.#onToggleEquip,
			deleteNpcItem: NpcSheet.#onDeleteItem,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/npc-header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		main: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/npc-main.hbs",
		},
		inventory: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/npc-inventory.hbs",
		},
		psy: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/npc-psy.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/npc-notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "main", group: "primary", label: "NPC.TAB_MAIN" },
				{ id: "inventory", group: "primary", label: "NPC.TAB_INVENTORY" },
				{ id: "psy", group: "primary", label: "NPC.TAB_PSY" },
				{ id: "notes", group: "primary", label: "NPC.TAB_NOTES" },
			],
			initial: "main",
		},
	};

	/** The psychic tab exists only for psykers/navigators (bead m4me rule). */
	protected override _prepareTabs(
		group: string,
	): Record<string, foundry.applications.api.ApplicationV2.Tab> {
		const tabs = super._prepareTabs(group);
		const system = this.actor.system as unknown as Character;
		const powers = this.actor.items.filter(
			(i) =>
				(i.type as string) === "psychicpower" ||
				(i.type as string) === "navigatorpower",
		);
		if (
			!(system.psyker === true || (system.psyRating ?? 0) >= 1) &&
			powers.length === 0
		) {
			delete tabs.psy;
		}
		return tabs;
	}

	/**
	 * The ladder <select> fires change (not click, which is all data-action
	 * supports), so wire the change listeners per render — hooks/inputs are
	 * wired imperatively per AGENT-GUIDE §3.
	 */
	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		for (const select of this.element?.querySelectorAll<HTMLSelectElement>(
			"select.npc-ladder-select:not([data-wired])",
		) ?? []) {
			select.dataset.wired = "1";
			select.addEventListener("change", () => {
				NpcSheet.#onSetLadder(
					this.actor,
					select.dataset.item ?? "",
					Number(select.value),
				).catch((error) =>
					console.error("rogue-trader | npc ladder set failed:", error),
				);
			});
		}
	}

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.actor.system as unknown as Character;
		context.system = system;

		// Horizontal characteristic table: short row + value row.
		context.characteristics = (
			Object.keys(system.characteristics ?? {}) as Key[]
		).map((key) => ({
			key,
			short: CHAR_SHORTS[key],
			value: system.characteristics[key]?.value ?? 0,
		}));

		// Known-or-better skills (ladder >= 1), alphabetical. The number shown
		// on the line is the ROLL BONUS over the characteristic ((ladder-1)*10).
		context.skills = this.actor.items
			.filter((i) => {
				if ((i.type as string) !== "skill") return false;
				return ((i.system as unknown as { ladder: number }).ladder ?? 0) >= 1;
			})
			.map((i) => {
				const ladder = (i.system as unknown as { ladder: number }).ladder ?? 1;
				return {
					id: i.id ?? "",
					name: i.name ?? "",
					ladder,
					bonus: `+${(ladder - 1) * 10}`,
					ladderOptions: [
						{ value: 1, label: "SKILL.LADDER_KNOWN" },
						{ value: 2, label: "SKILL.LADDER_PLUS_10" },
						{ value: 3, label: "SKILL.LADDER_PLUS_20" },
					],
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name)) as never;

		// Combat: owned weapons with attack + damage rolls. equipState drives
		// the equip/stow toggle (owner spec: NPCs are HOLDING their listed
		// weapons, so drops default to carried — see #onDrop).
		context.weapons = this.actor.items
			.filter(
				(i) => (i.type as string) === "melee-weapon" || (i.type as string) === "ranged-weapon",
			)
			.map((i) => {
				const s = i.system as unknown as { damage?: string; equipState?: string };
				return {
					id: i.id ?? "",
					name: i.name ?? "",
					damage: s.damage ?? "",
					equipped: (s.equipState ?? "stowed") !== "stowed",
				};
			}) as never;

		// Inventory tab: armour stats (left) + minimal item list (right).
		const LOCATIONS = [
			"head",
			"left-arm",
			"body",
			"right-arm",
			"left-leg",
			"right-leg",
		] as const;
		const wornArmour = this.actor.items.filter(
			(item) =>
				(item.type as string) === "armour" &&
				(item.system as unknown as { equipState?: string }).equipState ===
					"worn",
		);
		context.armourTotals = LOCATIONS.map((loc) => ({
			loc,
			label: `BODY_LOCATION.${loc.toUpperCase().replace(/-/g, "_")}`,
			ap: Math.max(
				0,
				...wornArmour.map((item) =>
					(
						item.system as unknown as { armourAt(loc: string): number }
					).armourAt(loc),
				),
			),
		}));
		context.armourItems = this.actor.items
			.filter((item) => (item.type as string) === "armour")
			.map((item) => ({
				id: item.id ?? "",
				name: item.name ?? "",
				worn:
					(item.system as unknown as { equipState?: string }).equipState ===
					"worn",
				}));
		context.items = this.actor.items
			.filter(
				(item) =>
					!["skill", "psychicpower", "navigatorpower"].includes(
						item.type as string,
					),
			)
			.map((item) => ({
				id: item.id ?? "",
				name: item.name ?? "",
				type: item.type as string,
				})) as never;

		// Psychic/navigator powers for the conditional tab.
		context.powers = this.actor.items
			.filter(
				(i) =>
					(i.type as string) === "psychicpower" ||
					(i.type as string) === "navigatorpower",
			)
			.map((i) => ({
				id: i.id ?? "",
				name: i.name ?? "",
				type: i.type as string,
			})) as never;

		context.isPsyker =
			system.psyker === true || (system.psyRating ?? 0) >= 1;
		// Shared rich-text partial (bead bef7) renders notes via prose-mirror.
		context.notesHTML = await foundry.applications.ux.TextEditor.enrichHTML(
			system.notes ?? "",
			{ relativeTo: this.actor },
		);
		return context;
	}

	/** Click a characteristic cell to roll it. */
	static async #onRollTest(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key) return;
		await rollTest(this.actor, key, { skipDialog: false });
	}

		/** Click a known skill to roll it. */
	static async #onRollSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await rollSkill(this.actor, itemId, { skipDialog: false });
	}

	static async #onRollWeapon(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponAttack(this.actor, itemId);
	}

	static async #onRollDamage(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponDamage(this.actor, itemId);
	}

	/** Activate a psychic power (or navigator power by item type). */
	static async #onRollPower(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		if ((item.type as string) === "navigatorpower") {
			await rollNavigatorPower(this.actor, itemId);
		} else {
			await rollPsychicPower(this.actor, itemId);
		}
	}

	/**
	 * Ladder dropdown change: set the owned skill's ladder (Known/+10/+20).
	 * Drag-and-drop from the compendium adds the skill; the dropdown sets its
	 * level afterwards (replaces the SkillPicker button, bead mqdy).
	 */
	static async #onSetLadder(
		actor: foundry.documents.Actor,
		itemId: string,
		value: number,
	): Promise<void> {
		if (!itemId || !Number.isFinite(value)) return;
		await actor.items.get(itemId)?.update({
			system: { ladder: Math.min(3, Math.max(1, value)) },
		});
	}

	/** Remove an inventory item. */
	static async #onDeleteItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.itemId;
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}

	/** Equip/stow toggle (owner spec): NPCs wield the weapons they hold. */
	static async #onToggleEquip(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const current =
			(item.system as unknown as { equipState?: string }).equipState ?? "stowed";
		await item.update({ system: { equipState: current === "stowed" ? "carried" : "stowed" } });
	}

	/**
	 * Drop an external Item onto the NPC: clone it into the actor. Weapons
	 * arrive CARRIED and armour WORN — an NPC is holding/wearing whatever the
	 * GM gives it (owner spec, bead NPC-inventory); everything else stows.
	 */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		// NPC spec: dropped weapons arrive CARRIED, armour WORN — the NPC is
		// holding/wearing whatever the GM gives it; everything else stows.
		return cloneItemFromDrop(this.actor, event, {
			systemOverridesFor: npcEquipDefaultSystemOverrides,
		});
	}

	/**
	 * Reset a skill to unknown: delete the owned skill item (it leaves the
	 * known list and can be re-added at any ladder via the picker).
	 */
	static async #onDeleteSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}
}