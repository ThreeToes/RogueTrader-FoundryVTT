import { DamageType } from "../../data/item/damage-types";
import { ITEM_DATA_TABS } from "../tabs";
import { RangedWeapon } from "../../data/item/ranged-weapon";
import {
	MELEE_CLASSES,
	RANGED_CLASSES,
	WeaponClass,
} from "../../data/item/weapon-class";
import { acceptsOrdnance, LAUNCHER_FAMILY } from "../../../ffg/domain/model/attack";
import { weaponFamilies } from "../../registry";
import { cloneItemFromDrop } from "../drop-clone";
import { getPorts } from "../../infrastructure/foundry/ports";
import { effectActions, effectEditorChoices } from "./effect-actions";
import { itemDescriptionHTML } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";
import { loadOrdnance, OrdnancePicker } from "./ordnance-picker";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class WeaponSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "weapon",
		width: 520,
		height: "auto",
		actions: {
			...effectActions,
			loadOrdnance: WeaponSheet.#openOrdnancePicker,
			unloadOrdnance: WeaponSheet.#unloadOrdnance,
		},
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		data: {
			template: "systems/rogue-trader/template/sheet/item/tabs/weapon-data.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/item/tabs/notes.hbs",
		},
	};

	static TABS = ITEM_DATA_TABS;

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system;

		// Class choices already restricted per weapon type at the schema level;
		// the dropdown mirrors the schema restriction.
		const classes: WeaponClass[] =
			this.document.type === "melee-weapon" ? MELEE_CLASSES : RANGED_CLASSES;
		context.classChoices = Object.fromEntries(
			classes.map((value) => [value, `CLASS.${value.toUpperCase()}`]),
		);

		context.isRanged = this.document.type === "ranged-weapon";
		context.isMelee = this.document.type === "melee-weapon";

		// Weapon family (bead erzk): the Weapon Training talent-group the
		// gate resolves against. Blank = uncurated (schema initial).
		context.familyChoices = Object.fromEntries(weaponFamilies.entries());

		// Damage type choices mirror the schema (E/I/R/X book types).
		context.damageTypeChoices = Object.fromEntries(
			Object.values(DamageType).map((value) => [
				value,
				`DAMAGE_TYPE.${value.toUpperCase()}`,
			]),
		);

		// Quality toggle-chips: lookup map so `checked` marks existing picks.
		context.specialFlags = Object.fromEntries(
			(
				(this.document.system as unknown as { special?: string[] }).special ??
				[]
			).map((q) => [q, true]),
		);

		// Normalized rate of fire record so all fields exist for ranged weapons.
		context.rateOfFire = {
			singleShot: system.rateOfFire?.singleShot ?? false,
			burst: system.rateOfFire?.burst ?? 0,
			fullAuto: system.rateOfFire?.fullAuto ?? 0,
		};

		// Launcher load model (bead 4obp): the loaded item's name + remaining
		// quantity display on the sheet; the Load/Unload affordances sit beside
		// it. Non-launchers (and unowned launchers) render nothing here.
		if (
			context.isRanged &&
			String(system.weaponFamily ?? "").toLowerCase() === LAUNCHER_FAMILY
		) {
			const loadedAmmoId = String(system.loadedAmmoId ?? "");
			const actor = (this.document as { actor?: foundry.documents.Actor | null })
				.actor;
			const loaded =
				actor && loadedAmmoId
					? (actor.items.get(loadedAmmoId) ?? null)
					: null;
			context.launcher = {
				acceptsAmmo: String(system.acceptsAmmo ?? ""),
				loaded: loaded
					? {
							id: loaded.id,
							name: loaded.name,
							quantity: Number(
								(loaded.system as { quantity?: number }).quantity ?? 0,
							),
						}
					: null,
			};
		}

		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(
			context,
			effectEditorChoices(),
		);

		// Description tab: enriched HTML from the system description
		// (WeaponSheet/ArmourSheet don't extend GearSheet, which computes this).
		context.descriptionHTML = await itemDescriptionHTML(this.document);
		return context;
	}

	/**
	 * Drag an accepted item onto the weapon sheet = load (bead 4obp Option A).
	 * An owned item on the SAME actor loads directly; a compendium/foreign
	 * item is cloned onto the actor first (the shared drop-to-clone helper,
	 * matching the actor sheets' drop semantics) and the clone loads. A
	 * rejected item warns loudly — dropping unrelated gear onto a launcher
	 * must not quietly do nothing (repo rule: silent failure is a bug).
	 */
	protected override async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return undefined;
		const actor = (this.document as { actor?: foundry.documents.Actor | null })
			.actor;
		if (!actor) return undefined;
		const source = foundry.utils.fromUuidSync(data.uuid as never) as
			| foundry.documents.Item
			| null;
		if (!source) return undefined;
		if (!acceptsOrdnance(this.document as never, source as never)) {
			getPorts().notify.warn("RANGED_WEAPON.LOAD_REJECTED", {
				item: source.name ?? "",
			});
			return undefined;
		}
		// Already-owned (dragged off the actor's own sheet): load it directly;
		// otherwise clone it in (drop-on-inventory semantics) and load the clone.
		const owned =
			actor.items.find((i) => i.uuid === source.uuid) ??
			(await cloneItemFromDrop(actor, event));
		if (!owned) return undefined;
		await loadOrdnance(
			this.document as unknown as { update: (data: object) => Promise<void> },
			owned.id ?? "",
		);
		return owned;
	}

	/** Load button: open the picker of the actor's accepted ordnance. */
	static async #openOrdnancePicker(
		this: { document: foundry.documents.Item },
	): Promise<void> {
		const actor = (this.document as { actor?: foundry.documents.Actor | null })
			.actor;
		if (!actor) {
			getPorts().notify.warn("RANGED_WEAPON.LOAD_NO_ACTOR");
			return;
		}
		new OrdnancePicker({
			actor,
			weapon: this.document as never,
		}).render({ force: true });
	}

	/** Unload button: one click clears the load (bead 4obp Option A). */
	static async #unloadOrdnance(this: {
		document: { update: (data: object) => Promise<void> };
	}): Promise<void> {
		await this.document.update({ system: { loadedAmmoId: "" } });
	}
}
