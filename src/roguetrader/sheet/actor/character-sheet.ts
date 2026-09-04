import { Character } from "../../data/actor/character";
import { careers } from "../../registry";
import {
	rollSkill,
	rollSkillUntrained,
	rollTest,
	rollWeaponAttack,
	rollWeaponDamage,
} from "../../rules/adapter";
import { defaultSkillItems } from "../../rules/default-skills";
import { fatigueThreshold, woundsMax } from "../../rules/derived";
import { deriveCapacity, resolveEncumbrance } from "../../rules/encumbrance";
import { getSkillCatalog } from "./skill-catalog";
import { SkillPicker } from "./skill-picker";
import { TalentPicker } from "./talent-picker";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

interface CharacteristicView {
	key: string;
	label: string;
	value: number;
	bonus: number;
	effectiveBonus: number;
	unnatural: number;
	bonusTooltip: string;
	unnaturalTooltip: string;
	pips: Array<{ value: number; lit: boolean }>;
}

/** Max unnatural multiplier shown as pips. */
const MAX_UNNATURAL_STEPS = 5;

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
			setUnnatural: CharacterSheet.#onSetUnnatural,
			setLadder: CharacterSheet.#onSetLadder,
			openItem: CharacterSheet.#onOpenItem,
			deleteItem: CharacterSheet.#onDeleteItem,
			rollWeapon: CharacterSheet.#onRollWeapon,
			rollDamage: CharacterSheet.#onRollDamage,
			openTalentPicker: CharacterSheet.#onOpenTalentPicker,
			toggleEquip: CharacterSheet.#onToggleEquip,
		},
	};

	static async #onOpenItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (item) item.sheet?.render(true);
	}

	/** Delete an owned inventory item. */
	static async #onDeleteItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}

	/** Roll the to-hit test for a weapon on the combat tab (v1). */
	static async #onRollWeapon(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponAttack(this.actor, itemId);
	}

	/** Quick damage roll from a weapon row (no to-hit test). */
	static async #onRollDamage(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponDamage(this.actor, itemId);
	}

	static async #onOpenTalentPicker(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new TalentPicker({ actor: this.actor }).render({ force: true });
	}

	/**
	 * Toggle the equip state of an inventory item: stowed -> carried (or worn
	 * for armour); any ready state -> stowed.
	 */
	static async #onToggleEquip(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const type = item.type as string;
		if (
			!["weapon", "melee-weapon", "ranged-weapon", "armour", "gear"].includes(
				type,
			)
		)
			return;
		const current =
			(item.system as unknown as { equipState?: string }).equipState ??
			"stowed";
		const readyState = type === "armour" ? "worn" : "carried";
		const next = current === readyState ? "stowed" : readyState;
		await item.update({ system: { equipState: next } });
	}

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
		// Template attribute is data-value on ladder buttons (see skills.hbs).
		const ladder = Number(target.dataset.value);
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
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const current = (item as { system?: { ladder?: number } }).system?.ladder;
		// Click-to-own toggle (bead tnw): clicking the skill's active ladder
		// again removes it (no separate trash icon on the row).
		if (current === value) {
			await item.delete();
			return;
		}
		await item.update({ system: { ladder: value } });
	}

	/** Set the unnatural multiplier from a clicked pip; clicking the last lit pip resets to natural. */
	static async #onSetUnnatural(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		const value = Number(target.dataset.value);
		if (!key || Number.isNaN(value)) return;
		const current =
			(this.actor.system as unknown as Character).characteristics[key]
				?.unnatural ?? 1;
		const next = current === value ? 1 : value;
		await this.actor.update({
			system: { characteristics: { [key]: { unnatural: next } } },
		});
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
		combat: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/combat.hbs",
		},
		inventory: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/inventory.hbs",
		},
		talents: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/talents.hbs",
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
				{ id: "combat", group: "primary", label: "TAB.COMBAT" },
				{ id: "skills", group: "primary", label: "TAB.SKILLS" },
				{ id: "talents", group: "primary", label: "TAB.TALENTS" },
				{ id: "inventory", group: "primary", label: "TAB.INVENTORY" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	/**
	 * Inventory rows carry their item uuid; drag transfers core {type, uuid}
	 * data so rows can be dropped onto other sheets/hotbars.
	 */
	protected _onDragStart(event: DragEvent): void {
		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			"[data-item-uuid]",
		);
		if (!row?.dataset.itemUuid) return;
		event.dataTransfer?.setData(
			"text/plain",
			JSON.stringify({ type: "Item", uuid: row.dataset.itemUuid }),
		);
	}

	/**
	 * Drop an external Item onto the inventory to copy it into the actor.
	 * Drops of uuids already owned are no-ops (reordering comes later).
	 */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return;
		const source = await foundry.utils.fromUuid(data.uuid);
		if (!(source instanceof foundry.documents.Item)) return;
		if (this.actor.items.find((item) => item.uuid === source.uuid)) return;
		return this.actor.createEmbeddedDocuments("Item", [source.toObject()]);
	}

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

		// Career picker (bead 0ib): choices from the careers registry; the
		// read-only label resolves via the registry so homebrew careers work.
		context.careerChoices = Object.fromEntries(careers.entries());
		context.careerLabel = system.careerKey
			? (careers.get(system.careerKey) ?? system.careerKey)
			: "";

		context.characteristics = Object.entries(system.characteristics).map(
			([key, data]): CharacteristicView => {
				const bonus = system.characteristicBonus(key);
				const effectiveBonus = system.effectiveCharacteristicBonus(key);
				return {
					key,
					label: `CHARACTERISTIC.${key.toUpperCase()}`,
					value: data.value,
					unnatural: data.unnatural,
					bonus,
					effectiveBonus,
					bonusTooltip: game.i18n.format("CHARACTER.BONUS_TOOLTIP", {
						bonus: data.unnatural > 1 ? effectiveBonus : bonus,
					}),
					unnaturalTooltip: game.i18n.format("CHARACTER.UNNATURAL_TOOLTIP", {
						mult: data.unnatural,
					}),
					pips: Array.from({ length: MAX_UNNATURAL_STEPS }, (_, i) => {
						const mult = i + 2; // pip 1 = x2
						return { value: mult, lit: data.unnatural >= mult };
					}),
				};
			},
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

		// Inventory: all non-skill owned items grouped by family. Weight display
		// only - aggregation/encumbrance is deliberately NOT calculated here yet.
		const byType = (types: string[]) =>
			this.actor.items
				.filter((item) => types.includes(item.type as string))
				.map((item) => {
					const equipState = (item.system as unknown as { equipState?: string })
						.equipState;
					const type = item.type as string;
					return {
						id: item.id,
						name: item.name,
						uuid: item.uuid,
						weight: (item.system as unknown as { weight?: number }).weight ?? 0,
						equipState: equipState ?? "stowed",
						equipped: equipState === "carried" || equipState === "worn",
						// Weapons get the inline attack/damage roll button.
						isWeapon: type === "melee-weapon" || type === "ranged-weapon",
					};
				});
		const inventory: Array<{
			label: string;
			items: Array<{
				id: string | null;
				name: string | null;
				uuid: string;
				weight: number;
				equipState: string;
				equipped: boolean;
			}>;
			addLabel?: string;
			addAction?: string;
		}> = [
			{
				label: "WEAPON.HEADER",
				items: byType(["melee-weapon", "ranged-weapon"]),
			},
			{ label: "ARMOUR.HEADER", items: byType(["armour"]) },
			{ label: "GEAR.HEADER", items: byType(["gear"]) },
		];

		// Armour: highest AP per body location across owned armour items.
		// TODO(equip-state): once item-side equipState lands (bead n7m), filter to
		// equipped armour only. Stacking rules intentionally not modelled yet.
		const armourItems = this.actor.items.filter(
			(item) => item.type === "armour",
		);
		const LOCATIONS = [
			"head",
			"left-arm",
			"body",
			"right-arm",
			"left-leg",
			"right-leg",
		] as const;
		context.armourLocations = Object.fromEntries(
			LOCATIONS.map((loc) => {
				const ap = Math.max(
					0,
					...armourItems.map((item) =>
						(
							item.system as unknown as { armourAt(loc: string): number }
						).armourAt(loc),
					),
				);
				return [loc, { ap }];
			}),
		);

		// Combat tab: weapons from inventory with visible stats (display only;
		// roll buttons land with the roll-damage adapter work).
		context.weapons = this.actor.items
			.filter(
				(item) => item.type === "melee-weapon" || item.type === "ranged-weapon",
			)
			.map((item) => {
				const sys = item.system as unknown as {
					class: string;
					damage?: string;
					penetration?: number;
					clip?: number;
					rateOfFire?: {
						singleShot: boolean;
						burst: number;
						fullAuto: number;
					};
				};
				const isRanged = item.type === "ranged-weapon";
				return {
					id: item.id,
					name: item.name,
					classLabel: `CLASS.${(sys.class ?? "melee").toUpperCase()}`,
					damage: sys.damage || "\u2013",
					penetration: sys.penetration ?? 0,
					isRanged,
					rof: {
						singleShot: sys.rateOfFire?.singleShot ? "S" : "\u2013",
						burst: sys.rateOfFire?.burst || "\u2013",
						fullAuto: sys.rateOfFire?.fullAuto || "\u2013",
					},
					clip: sys.clip ?? 0,
				};
			})
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

		context.inventory = inventory;

		// Talents: dedicated first-class tab (bead 7gb), sharing the inventory
		// row anatomy.
		context.talentRows = byType(["talent"]);

		// Encumbrance: carried weight vs capacity derived from Strength Bonus
		// (rules/encumbrance.ts deriveCapacity, VERIFY book rule).
		const carried = [
			...byType(["melee-weapon", "ranged-weapon"]),
			...byType(["armour"]),
			...byType(["gear"]),
		].reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
		const capacity = deriveCapacity(system.characteristicBonus("s"));
		context.encumbrance = resolveEncumbrance(carried, capacity);
		// Derived values (read-only): definitional + rules-layer, no writeback.
		context.derived = {
			...system.movement(),
			initiative: system.initiativeBonus(),
			woundsMax: woundsMax(
				system,
				this.actor.items
					.filter((item) => item.type === "talent")
					.map((item) => item.system as never),
			),
			fatigueMax: fatigueThreshold(system),
		};

		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(system.description, {
				secrets: this.actor.isOwner,
				relativeTo: this.actor,
			});

		return context;
	}
}
