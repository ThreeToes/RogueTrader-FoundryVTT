import {
	crewQualityEffects,
	CREW_QUALITIES,
} from "../../data/actor/starship-actor";
import {
	broadsideWeapon,
	deriveShipStats,
	parseWeaponCapacity,
	validateWeaponSlots,
	WEAPON_SLOTS,
	type WeaponSlot,
} from "../../rules/ship-systems";
import {
	crippledEffects,
	emergencyRepairsCanFix,
	SHIP_COMPONENT_STATES,
} from "../../../rules-engine/index";
import {
	performRoll,
	rollShipSalvo,
} from "../../rules/adapter";
import { cloneItemFromDrop } from "../drop-clone";
import { formatShipWeaponRange, normalizeShipWeaponRange } from "../../data/item/ship-weapon-range";
import type { ShipWeaponRange } from "../../data/item/ship-weapon-range";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import { sheetContext } from "../context";
import { enrichText } from "../rich-text";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { getPackDocuments } from "../pack-resolve";

/** Component state → localized SHIP_COMBAT.STATE_* label (bead uc08).
    Unknown states fall back to the raw key so corruption is loud. */
function componentStateLabel(state: string): string {
	return game.i18n.localize(`SHIP_COMBAT.STATE_${state.toUpperCase()}`);
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
import { imageActions } from "../image-actions";

export class ShipSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "starship"],
		position: { width: 640, height: 560 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			editImage: imageActions.editImage,
			rollOddity: ShipSheet.#onRollOddity,
			rollHistory: ShipSheet.#onRollHistory,
			removeComponent: ShipSheet.#onRemoveComponent,
			setWeaponSlot: ShipSheet.#onSetWeaponSlot,
			openItem: ShipSheet.#onOpenItem,
			fireWeapon: ShipSheet.#onFireWeapon,
			repairComponent: ShipSheet.#onRepairComponent,
			setComponentState: ShipSheet.#onSetComponentState,
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
		combat: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/ship-combat.hbs",
		},
		notes: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/ship-notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "hull", group: "primary", label: "STARSHIP.TAB_HULL", cssClass: "" },
				{ id: "refit", group: "primary", label: "STARSHIP.TAB_REFIT", cssClass: "" },
				{
					id: "combat",
					group: "primary",
					label: "STARSHIP.TAB_COMBAT",
					cssClass: "",
				},
				{
					id: "notes",
					group: "primary",
					label: "STARSHIP.TAB_NOTES",
					cssClass: "",
				},
			],
			initial: "hull",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("STARSHIP.HEADER")}: ${this.document.name}`;
	}

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
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
			notes: string;
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
		// Complications (Tables 8-1 / 8-2): the stored value plus its
		// compendium effect — the effect ONLY when the ships pack provides
		// it, never fabricated (owner round 6). The pack is fetched ONCE per
		// render (bead yi5t) and shared by both complication lookups.
		const shipsDocs = (await getPackDocuments(
			"rogue-trader.ships",
		)) as Array<{
			type?: string;
			name?: string;
			system?: { kind?: string; effect?: string };
		}>;
		context.oddity = await this.#complicationContext(
			shipsDocs,
			"machine-spirit-oddity",
			system.machineSpiritOddity,
		);
		context.history = await this.#complicationContext(
			shipsDocs,
			"past-history",
			system.pastHistory,
		);
		const components = this.#ownedComponents();
		context.components = components;
		// Installed components grouped by category (bead pyi3: inventory-style
		// primary view; the pack pickers are demoted browse affordances).
		context.installedGroups = COMPONENT_CATEGORIES.map(
			({ key, labelKey }) => ({
				key,
				labelKey,
				items: components.filter((c) => c.category === key),
			}),
		).filter((g) => g.items.length > 0);
		// Per-weapon slot chips (owner round 7): a slot chip is ENABLED when
		// the hull declares capacity for it, the weapon could legally occupy
		// it (broadsides are Port/Starboard only, Table 8-4), and the slot is
		// not already full of OTHER weapons. Disabled chips carry the reason
		// as their tooltip.
		const capacitySlots = parseWeaponCapacity(system.weaponCapacity ?? "");
		const weaponComponents = components.filter(
			(c) => c.type === "ship-weapon-component",
		);
		const usedCounts: Partial<Record<string, number>> = {};
		for (const w of weaponComponents) {
			const slot = (w.slot ?? "").toLowerCase();
			if (slot) usedCounts[slot] = (usedCounts[slot] ?? 0) + 1;
		}
		for (const w of weaponComponents) {
			const broadside = broadsideWeapon(w.name, w.special);
			const ownSlot = (w.slot ?? "").toLowerCase();
			w.slotChips = WEAPON_SLOTS.map((key) => {
				const max = capacitySlots[key as WeaponSlot] ?? 0;
				let reason = "";
				if (max === 0) {
					reason = game.i18n.localize("STARSHIP.ISSUE_UNKNOWN_SLOT");
				} else if (broadside && key !== "port" && key !== "starboard") {
					reason = game.i18n.localize("STARSHIP.ISSUE_BROADSIDE_SLOT");
				} else {
					const usedElsewhere =
						(usedCounts[key] ?? 0) - (ownSlot === key ? 1 : 0);
					if (usedElsewhere >= max) {
						reason = game.i18n.localize("STARSHIP.ISSUE_OVER_CAPACITY");
					}
				}
				return {
					key,
					label: game.i18n.localize(`STARSHIP.SLOT_${key.toUpperCase()}`),
					disabled: reason.length > 0,
					reason,
				};
			});
		}
		// Derived totals (bead om4j): recomputed from installed items on every
		// render so space/SP/power/shields never drift from the items.
		const derived = deriveShipStats(components);
		context.derived = derived;
		// Capacity-bar meters (bead 7dt0): fill percentages and over-capacity
		// flags for the shared rt/capacity-bar partial, computed once per render
		// so the Hull tab and the Refit budget strip never disagree.
		const spaceTotal = Math.max(0, system.space?.total ?? 0);
		const spTotal = Math.max(0, system.sp?.total ?? 0);
		const powerTotal = Math.max(0, derived.powerGenerated);
		const pct = (used: number, total: number): number =>
			total > 0
				? Math.min(100, Math.round((used / total) * 100))
				: used > 0
					? 100
					: 0;
		context.meters = {
			power: {
				used: derived.powerUsed,
				total: powerTotal,
				pct: pct(derived.powerUsed, powerTotal),
				over: derived.powerDeficit > 0,
			},
			space: {
				used: derived.spaceUsed,
				total: spaceTotal,
				pct: pct(derived.spaceUsed, spaceTotal),
				over: derived.spaceUsed > spaceTotal,
			},
			sp: {
				used: derived.spSpent,
				total: spTotal,
				pct: pct(derived.spSpent, spTotal),
				over: derived.spSpent > spTotal,
			},
		};
		context.weaponSlots = Object.fromEntries(
			WEAPON_SLOTS.map((slot) => [slot, `STARSHIP.SLOT_${slot.toUpperCase()}`]),
		);
		context.weaponIssues = validateWeaponSlots(
			system.weaponCapacity,
			components.filter((c) => c.type === "ship-weapon-component"),
		).map((issue) => ({
			name: issue.name,
			slot: issue.slot
				? game.i18n.localize(`STARSHIP.SLOT_${issue.slot.toUpperCase()}`)
				: "",
			message: game.i18n.localize(
				// The kind carries hyphens ("unknown-slot"); the i18n keys use
				// underscores (ISSUE_UNKNOWN_SLOT).
				`STARSHIP.ISSUE_${issue.kind.toUpperCase().replaceAll("-", "_")}`,
			),
		}));
		// Shared rich-text partial (bead bef7) renders notes via prose-mirror.
		context.notesHTML = await enrichText(system.notes ?? "", this.document);
		// Combat tab (bead xfta): weapons with fire buttons, hull + crew
		// status, crippled-state effects (book p221), component conditions
		// (book p223) and the repairs column.
		context.combat = this.#combatContext(components);
		return context;
	}

	/** Combat-tab context: status + weapons + repairable components. */
	#combatContext(components: Array<{
		id: string;
		name: string;
		type: string;
		power: string;
		space: number;
		sp: string;
		category: string;
		slot: string;
		special: string;
		state: string;
		stateLabel: string;
	}>): Record<string, unknown> {
		const doc = this.document.system as unknown as {
			hullIntegrity: { value: number; max: number };
			crewPopulation: number;
			crewMorale: number;
			voidShields: number;
			crewQuality: string;
		};
		const crippled = crippledEffects(doc.hullIntegrity?.value ?? 0);
		const crew = crewQualityEffects(doc.crewQuality ?? "competent");
		const weapons = components
			.filter((c) => c.type === "ship-weapon-component")
			.map((c) => ({ ...c }));
		// Load the weapon combat stats off the item system.
		for (const w of weapons) {
			const item = this.document.items.get(w.id);
			const s = (item?.system ?? {}) as unknown as {
				strength?: number;
				damage?: string;
				critRating?: number;
				range?: ShipWeaponRange | number; // legacy single-number docs
				state?: string;
				depressurised?: boolean;
			};
			// Crippled ships halve weapon Strength (round up, book p221).
			const rawStrength = s.strength ?? 0;
			w.slot = w.slot ?? "";
			w.stateLabel = componentStateLabel(s.state ?? "intact");
			Object.assign(w, {
				damage: s.damage ?? "",
				critRating: s.critRating ?? 0,
				range: normalizeShipWeaponRange(s.range),
				// Display string for the battery card (bead gq2g): one number
				// when min === max, 'min-max' for a banded range.
				rangeLabel: formatShipWeaponRange(s.range),
				state: s.state ?? "intact",
				depressurised: s.depressurised === true,
				slotLabel: w.slot
					? `STARSHIP.SLOT_${w.slot.toUpperCase()}`
					: "STARSHIP.ISSUE_UNASSIGNED",
				strength: crippled.weaponStrengthHalved
					? Math.ceil(rawStrength / 2)
					: rawStrength,
			});
		}
		const repairable = components.filter((c) => {
			const item = this.document.items.get(c.id);
			const s = (item?.system ?? {}) as unknown as {
				state?: string;
				depressurised?: boolean;
			};
			return emergencyRepairsCanFix(
				(s.state ?? "intact") as never,
				s.depressurised === true,
			);
		});
		// Merged component roster (bead uc08): every installed component with
		// its status badge + repair eligibility, replacing the separate
		// Emergency Repairs and GM Component Conditions sections. Split by
		// type (owner round 2): ship components and weapon components get
		// their own sections so names keep their line space.
		const roster = components
			.filter((c) => c.type !== "ship-weapon-component")
			.map((c) => ({
				...c,
				repairable: repairable.some((r) => r.id === c.id),
			}));
		const weaponRoster = components
			.filter((c) => c.type === "ship-weapon-component")
			.map((c) => ({
				...c,
				repairable: repairable.some((r) => r.id === c.id),
			}));
		return {
			hullIntegrity: doc.hullIntegrity,
			crewPopulation: doc.crewPopulation ?? 100,
			crewMorale: doc.crewMorale ?? 100,
			voidShields: doc.voidShields ?? 0,
			// Vitals-strip pips (bead ecnp): one entry per shield, all lit —
			// shields have no book-defined maximum to burn down towards.
			voidShieldPips: Array.from({ length: doc.voidShields ?? 0 }),
			crewSkill: crew.skill,
			crippled,
			weapons,
			roster,
			weaponRoster,
			componentStates: Object.fromEntries(
				SHIP_COMPONENT_STATES.map((state) => [
					state,
					componentStateLabel(state),
				]),
			),
		};
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
		state: string;
		stateLabel: string;
		slotChips?: Array<{
			key: string;
			label: string;
			disabled: boolean;
			reason: string;
		}>;
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
					state?: string;
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
					// Status badge (bead uc08): state + localized label.
					state: s.state ?? "intact",
					stateLabel: componentStateLabel(s.state ?? "intact"),
					// Condensed cost chip (owner round 5): "P1 S3 SP-" for
					// consumers, "G45 S10 SP+1" for generators — the pack power
					// strings carry "Generated", the sp strings carry their own
					// sign ("-", "+1").
					cost: `${/generated/i.test(s.power ?? "") ? "G" : "P"}${(s.power ?? "").match(/-?\d+/)?.[0] ?? "?"} S${s.space ?? 0} SP${s.sp ?? "-"}`,
				};
			}) as never;
	}

	/**
	 * One complications section (owner round 6): the stored name plus its
	 * compendium effect. The effect comes ONLY from the ships pack — if the
	 * pack or the entry is unavailable, effect stays null and the template
	 * shows no text (never fabricated). A "? (roll N)" fallback from a roll
	 * that found no entry counts as unset, so the roll button returns.
	 */
	async #complicationContext(
		docs: Array<{
			type?: string;
			name?: string;
			system?: { kind?: string; effect?: string };
		}>,
		kind: string,
		value: string,
	): Promise<{ name: string; hasValue: boolean; effect: string | null }> {
		const name = value ?? "";
		const hasValue = name.trim().length > 0 && !name.startsWith("?");
		let effect: string | null = null;
		if (hasValue) {
			const hit = docs.find(
				(d) =>
					d.type === "ship-complication" &&
					d.system?.kind === kind &&
					d.name === name,
			);
			effect = hit?.system?.effect ?? null;
		}
		return { name, hasValue, effect };
	}

	/** Roll 1d10 on a complications table and record the result name. */
	static async #onRollOddity(this: ShipSheet): Promise<void> {
		await this.#rollComplication("machine-spirit-oddity", "machineSpiritOddity");
	}

	static async #onRollHistory(this: ShipSheet): Promise<void> {
		await this.#rollComplication("past-history", "pastHistory");
	}

	/**
	 * Drop an Item from a compendium onto the ship: install it (bead pyi3).
	 * Only ship-component / ship-weapon-component items are accepted — a
	 * loud warning for anything else. Duplicates are allowed (refit may
	 * install the same component twice), so skipOwned is off.
	 */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		const created = await cloneItemFromDrop(this.document, event, {
			skipOwned: false,
		});
		if (!created) return;
		const type = (created.type as string) ?? "";
		if (type !== "ship-component" && type !== "ship-weapon-component") {
			console.warn(
				`rogue-trader | ship refit: "${created.name}" (${type}) is not a ship component; not installed`,
			);
			await this.document.deleteEmbeddedDocuments("Item", [created.id]);
			getPorts().notify.warn("STARSHIP.DROP_NOT_COMPONENT", {
				name: created.name ?? "",
			});
			return;
		}
		await this.#clampVoidShields();
		this.render({ force: true });
		return created;
	}

	/** Install a component from a uuid (browse-chips path, bead f5xu). */
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
		// Round 5: the slot picker is BUTTON CHIPS (data-slot); the select
		// path stays as a fallback for any other caller.
		const slot = target.dataset.slot ?? (target as HTMLSelectElement).value;
		if (!id) return;
		const item = this.document.items.get(id);
		if (!item) return;
		await item.update({ system: { slot } } as never);
	}

	/** Open a weapon/component item sheet (bead ecnp battery cards). */
	static #onOpenItem(
		this: ShipSheet,
		_event: Event,
		target: HTMLElement,
	): void {
		const id = target.dataset.itemId;
		if (!id) return;
		this.document.items.get(id)?.sheet?.render(true);
	}

	/**
	 * Fire an installed weapon (bead xfta, book p220): prompt the range
	 * band vs the target, then run the ship-weapon roll kind (gunner BS
	 * test -> hits -> void shields -> damage -> criticals). UNVERIFIED IN
	 * WORLD: range is banded rather than VU-measured for v1.
	 */
	static async #onFireWeapon(
		this: ShipSheet,
		_event: Event,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		if (!id) return;
		const choice = (await foundry.applications.api.DialogV2.wait({
			window: { title: game.i18n.localize("SHIP_COMBAT.FIRE_TITLE") },
			content: `<p>${game.i18n.localize("SHIP_COMBAT.FIRE_PROMPT")}</p>`,
			buttons: [
				{
					action: "half",
					label: game.i18n.localize("SHIP_COMBAT.RANGE_HALF"),
					callback: () => "half",
				},
				{
					action: "normal",
					label: game.i18n.localize("SHIP_COMBAT.RANGE_NORMAL"),
					callback: () => "normal",
				},
				{
					action: "long",
					label: game.i18n.localize("SHIP_COMBAT.RANGE_LONG"),
					callback: () => "long",
				},
			],
		})) as string | null;
		if (!choice) return;
		const band = (choice === "half" || choice === "long"
			? choice
			: "normal") as "half" | "normal" | "long";
		await rollShipSalvo(this.document, id, band);
	}

	/** Emergency Repairs on an installed component (book p216-218). */
	static async #onRepairComponent(
		this: ShipSheet,
		_event: Event,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		if (!id) return;
		await performRoll({ kind: "ship-repair", actor: this.document, itemId: id } as never);
	}

	/** GM manual component-state override (book p223 condition vocabulary). */
	static async #onSetComponentState(
		this: ShipSheet,
		_event: Event,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		// Bead z132-family round 3: the roster state picker is BUTTON CHIPS
		// (data-state); the old select path stays for the depressurised toggle.
		const state = target.dataset.state ?? (target as HTMLSelectElement).value;
		if (!id) return;
		const item = this.document.items.get(id);
		if (!item) return;
		const depressurised = (target as HTMLSelectElement).dataset.depressurised;
		if (depressurised !== undefined) {
			await item.update({
				system: { depressurised: depressurised === "true" },
			} as never);
			return;
		}
		await item.update({ system: { state } } as never);
	}

	async #rollComplication(kind: string, field: string): Promise<void> {
		const result = (await getPorts().dice.roll("1d10")).total ?? 1;
		const docs = (await getPackDocuments("rogue-trader.ships")) as Array<{
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