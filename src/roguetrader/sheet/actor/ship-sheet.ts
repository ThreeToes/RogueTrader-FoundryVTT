import {
	crewQualityEffects,
	CREW_QUALITIES,
} from "../../data/actor/starship-actor";
import {
	deriveShipStats,
	validateWeaponSlots,
	WEAPON_SLOTS,
} from "../../rules/ship-systems";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Row for the hull picker: ships pack `ship` docs. */
interface HullOption {
	uuid: string;
	name: string;
	hullClass: string;
	sp: number;
}

/** Category groups for the component picker (bead f5xu). */
const COMPONENT_CATEGORIES: Array<{ key: string; labelKey: string }> = [
	{ key: "essential", labelKey: "STARSHIP.COMPONENTS_ESSENTIAL" },
	{ key: "supplemental", labelKey: "STARSHIP.COMPONENTS_SUPPLEMENTAL" },
	{ key: "archeotech", labelKey: "STARSHIP.COMPONENTS_ARCHEOTECH" },
	{ key: "xenotech", labelKey: "STARSHIP.COMPONENTS_XENOTECH" },
];

/**
 * Starship sheet (bead kwd): hull snapshot fields, crew quality (with its
 * SP delta), the two Complications (rolled from the ships pack with
 * 1d10), Ship Points and Space trackers, and notes. Fully resizable.
 */
export class ShipSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "starship"],
		position: { width: 640, height: 560 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollOddity: ShipSheet.#onRollOddity,
			pickHull: ShipSheet.#onPickHull,
			rollHistory: ShipSheet.#onRollHistory,
			addComponent: ShipSheet.#onAddComponent,
			removeComponent: ShipSheet.#onRemoveComponent,
			toggleComponentGroup: ShipSheet.#onToggleComponentGroup,
			setWeaponSlot: ShipSheet.#onSetWeaponSlot,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/ship-header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		hull: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/starship.hbs",
		},
		refit: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/ship-refit.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "hull", group: "primary", label: "STARSHIP.TAB_HULL" },
				{ id: "refit", group: "primary", label: "STARSHIP.TAB_REFIT" },
			],
			initial: "hull",
		},
	};

	/** Session-only collapsed state for the refit component categories. */
	componentCollapsed: Record<string, boolean> = { essential: false };

	override get title(): string {
		return `${game.i18n.localize("STARSHIP.HEADER")}: ${this.document.name}`;
	}

	async #hullOptions(): Promise<HullOption[]> {
		const pack = game.packs?.get("rogue-trader.ships");
		if (!pack) return [];
		const docs = (await pack.getDocuments()) as unknown as Array<{
			uuid?: string;
			name?: string;
			type?: string;
			system?: { hullClass?: string; sp?: number };
		}>;
		return docs
			.filter((d) => d.type === "ship")
			.map((d) => ({
				uuid: d.uuid ?? "",
				name: d.name ?? "",
				hullClass: d.system?.hullClass ?? "",
				sp: d.system?.sp ?? 0,
			}));
	}

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as unknown as {
			hullName: string;
			hullClass: string;
			dimensions: string;
			mass: string;
			crew: string;
			accel: string;
			speed: number;
			manoeuvrability: number;
			detection: number;
			hullIntegrity: { value: number; max: number };
			armour: number;
			turretRating: number;
			space: { total: number; used: number };
			sp: { total: number; spent: number };
			weaponCapacity: string;
			crewQuality: string;
			machineSpiritOddity: string;
			pastHistory: string;
			spRemaining: number;
		};
		context.system = system;
		context.crewQualities = Object.fromEntries(
			Object.keys(CREW_QUALITIES).map((key) => [
				key,
				game.i18n.localize(`STARSHIP.CREW_${key.toUpperCase()}`),
			]),
		);
		const crew = crewQualityEffects(system.crewQuality);
		context.crewSkill = crew.skill;
		context.crewSpDelta = crew.spDelta;
		context.spRemaining = system.spRemaining;
		context.hullOptions = await this.#hullOptions();
		const components = this.#ownedComponents();
		context.components = components;
		context.componentGroups = await this.#componentGroups();
		// Derived totals (bead om4j): recomputed from installed items on every
		// render so space/SP/power/shields never drift from the items.
		context.derived = deriveShipStats(components);
		context.weaponSlots = Object.fromEntries(
			WEAPON_SLOTS.map((slot) => [slot, `STARSHIP.SLOT_${slot.toUpperCase()}`]),
		);
		context.weaponIssues = validateWeaponSlots(
			system.weaponCapacity,
			components.filter((c) => c.type === "ship-weapon-component"),
		).map((issue) => ({
			name: issue.name,
			slot: issue.slot ?? "",
			message: game.i18n.localize(
				`STARSHIP.ISSUE_${issue.kind.toUpperCase()}`,
			),
		}));
		return context;
	}

	/** Toggle a refit category's collapsed state (session-only). */
	static #onToggleComponentGroup(this: ShipSheet, _event: unknown, target: HTMLElement): void {
		const key = target.dataset.group;
		if (!key) return;
		if (this.componentCollapsed[key]) delete this.componentCollapsed[key];
		else this.componentCollapsed[key] = true;
		this.render({ force: true });
	}

	/** Owned component items on this ship (bead f5xu). */
	#ownedComponents(): Array<{
		id: string;
		name: string;
		type: string;
		power: string;
		space: number;
		sp: string;
		category: string;
		slot: string;
		special: string;
	}> {
		return this.document.items
			.filter((i) => {
				const t = (i.type as string) ?? "";
				return t === "ship-component" || t === "ship-weapon-component";
			})
			.map((i) => {
				const s = i.system as unknown as {
					power?: string;
					space?: number;
					sp?: string;
					category?: string;
					slot?: string;
					special?: string;
				};
				return {
					id: i.id ?? "",
					name: i.name ?? "",
					type: (i.type as string) ?? "",
					power: s.power ?? "",
					space: s.space ?? 0,
					sp: s.sp ?? "-",
					category: s.category ?? "supplemental",
					slot: s.slot ?? "",
					special: s.special ?? "",
				};
			}) as never;
	}

	/** Ships-pack component picker, grouped by category. */
	async #componentGroups(): Promise<Array<{
		key: string;
		labelKey: string;
		items: Array<{ uuid: string; name: string; power: string; space: number; sp: string }>;
	}>> {
		const pack = game.packs?.get("rogue-trader.ships");
		if (!pack) return [];
		const docs = (await pack.getDocuments()) as unknown as Array<{
			uuid?: string;
			name?: string;
			type?: string;
			system?: {
				power?: string;
				space?: number;
				sp?: string;
				category?: string;
			};
		}>;
		return COMPONENT_CATEGORIES.map(({ key, labelKey }) => ({
			key,
			labelKey,
			open: !this.componentCollapsed[key],
			items: docs
				.filter(
					(d) =>
						(d.type === "ship-component" || d.type === "ship-weapon-component") &&
						d.system?.category === key,
				)
				.map((d) => ({
					uuid: d.uuid ?? "",
					name: d.name ?? "",
					power: d.system?.power ?? "",
					space: d.system?.space ?? 0,
					sp: d.system?.sp ?? "-",
				})),
		}));
	}

	/** Roll 1d10 on a complications table and record the result name. */
	static async #onRollOddity(this: ShipSheet): Promise<void> {
		await this.#rollComplication("machine-spirit-oddity", "machineSpiritOddity");
	}

	/** Pick a hull from the ships pack: copy its statline into the actor. */
	static async #onPickHull(
		this: ShipSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		const hull = (await foundry.utils.fromUuid(uuid)) as unknown as {
			name?: string;
			system?: {
				hullClass?: string;
				dimensions?: string;
				mass?: string;
				crew?: string;
				accel?: string;
				speed?: number;
				manoeuvrability?: number;
				detection?: number;
				hullIntegrity?: number;
				armour?: number;
				turretRating?: number;
				space?: number;
				sp?: number;
				weaponCapacity?: string;
			};
		} | null;
		if (!hull?.system) return;
		const s = hull.system;
		await this.document.update({
			system: {
				hullName: hull.name ?? "",
				hullClass: s.hullClass ?? "",
				dimensions: s.dimensions ?? "",
				mass: s.mass ?? "",
				crew: s.crew ?? "",
				accel: s.accel ?? "",
				speed: s.speed ?? 0,
				manoeuvrability: s.manoeuvrability ?? 0,
				detection: s.detection ?? 0,
				hullIntegrity: { value: s.hullIntegrity ?? 0, max: s.hullIntegrity ?? 0 },
				armour: s.armour ?? 0,
				turretRating: s.turretRating ?? 0,
				space: { total: s.space ?? 0, used: 0 },
				sp: { total: s.sp ?? 0, spent: 0 },
				weaponCapacity: s.weaponCapacity ?? "",
			},
		} as never);
	}

	static async #onRollHistory(this: ShipSheet): Promise<void> {
		await this.#rollComplication("past-history", "pastHistory");
	}

	/** Add a component from the ships pack (bead f5xu): clone as an item. */
	static async #onAddComponent(
		this: ShipSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		try {
			const doc = (await foundry.utils.fromUuid(uuid)) as unknown as {
				toObject?: () => object;
			} | null;
			if (!doc?.toObject) {
				console.warn(`rogue-trader | component "${uuid}" did not resolve`);
				return;
			}
			const data = doc.toObject() as { system?: Record<string, unknown> };
			await this.document.createEmbeddedDocuments("Item", [
				{ ...data, system: { ...data.system } },
			] as never);
			// New array may raise the shield max; clamp current upward is not
			// needed (shields start at max), but keep current within bounds.
			await this.#clampVoidShields();
		} catch (error) {
			console.error("rogue-trader | component add failed:", error);
		}
	}

	/** Remove an installed component, then clamp void shields to the new max. */
	static async #onRemoveComponent(
		this: ShipSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		if (!id) return;
		await this.document.deleteEmbeddedDocuments("Item", [id]);
		await this.#clampVoidShields();
	}

	/** Clamp stored voidShields.current to the max granted by installed arrays. */
	async #clampVoidShields(): Promise<void> {
		const { voidShieldsMax } = deriveShipStats(this.#ownedComponents());
		const current = (
			this.document.system as unknown as { voidShields?: number }
		).voidShields ?? 0;
		if (current > voidShieldsMax) {
			await this.document.update({ system: { voidShields: voidShieldsMax } } as never);
		}
	}

	/** Assign a weapon component to a capacity slot (bead om4j, Table 8-4). */
	static async #onSetWeaponSlot(
		this: ShipSheet,
		_event: Event,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		const slot = (target as HTMLSelectElement).value;
		if (!id) return;
		const item = this.document.items.get(id);
		if (!item) return;
		await item.update({ system: { slot } } as never);
	}

	async #rollComplication(kind: string, field: string): Promise<void> {
		const roll = new foundry.dice.Roll("1d10");
		await roll.evaluate();
		const result = roll.total ?? 1;
		const pack = game.packs?.get("rogue-trader.ships");
		if (!pack) return;
		const docs = (await pack.getDocuments()) as unknown as Array<{
			type?: string;
			name?: string;
			system?: { kind?: string; roll?: number };
		}>;
		const hit = docs.find(
			(d) => d.type === "ship-complication" && d.system?.kind === kind && d.system?.roll === result,
		);
		await this.document.update({
			system: { [field]: hit?.name ?? `? (roll ${result})` },
		} as never);
	}
}