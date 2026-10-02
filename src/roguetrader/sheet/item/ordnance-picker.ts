import { acceptsOrdnance } from "../../../ffg/domain/model/attack";
import { OwnedItemPicker } from "../actor/owned-picker";
import { sheetContext } from "../context";
import { getPorts } from "../../infrastructure/foundry/ports";

/**
 * Load-ordnance picker (bead 4obp, epic nlsh load-model): lists the OWNING
 * actor's items this launcher accepts (acceptsAmmo — missiles are ammunition
 * docs with an `ordnance` block; grenades are throw-family ranged weapons)
 * and loading picks one into the weapon's `system.loadedAmmoId`. The window
 * opens from the weapon sheet's Load button; drag-onto-sheet is the second
 * affordance (WeaponSheet._onDrop). Reuses the owned-picker anatomy and
 * styling (skill/talent/psychic pickers).
 */

/** Structural shape of the launcher weapon the picker loads into. */
interface LauncherDoc {
	type?: string;
	name?: string;
	actor?: foundry.documents.Actor | null;
	system?: { acceptsAmmo?: string; weaponFamily?: string };
	update?: (data: object) => Promise<void>;
}

/** Structural launcher read (acceptsAmmo/loading live on ranged weapons). */
export function isLauncher(
	weapon: { type?: string; system?: { weaponFamily?: string } } | null,
): boolean {
	return (
		weapon?.type === "ranged-weapon" &&
		String(weapon.system?.weaponFamily ?? "").toLowerCase() === "launcher"
	);
}

/**
 * Write the load: the launcher's system.loadedAmmoId. Owned launchers only —
 * a compendium/world item has no actor to resolve the loaded item against.
 */
export async function loadOrdnance(
	weapon: { update?: (data: object) => Promise<void> },
	itemId: string,
): Promise<void> {
	if (!weapon.update) {
		getPorts().notify.warn("RANGED_WEAPON.LOAD_NO_ACTOR");
		return;
	}
	await weapon.update({ system: { loadedAmmoId: itemId } });
}

export class OrdnancePicker extends OwnedItemPicker {
	/** The launcher weapon receiving the load. */
	#weapon: LauncherDoc;

	constructor(options: {
		actor: foundry.documents.Actor;
		weapon: LauncherDoc;
	}) {
		super(options);
		this.#weapon = options.weapon;
	}

	static DEFAULT_OPTIONS = OwnedItemPicker.pickerOptions({
		id: "rogue-trader-ordnance-picker",
		slug: "ordnance-picker",
		titleKey: "RANGED_WEAPON.LOAD",
		width: 400,
		height: 300,
		actions: {
			pick: OrdnancePicker.#pick,
		},
	});

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/ordnance-picker.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options as never));
		// Only launchers load; anything else lists nothing (loud empty state).
		const candidates = isLauncher(this.#weapon)
			? this.actor.items
					.filter((item) => acceptsOrdnance(this.#weapon as never, item as never))
					.map((item) => ({
						id: item.id ?? "",
						name: item.name ?? "",
						quantity: Number(
							(item.system as { quantity?: number } | undefined)?.quantity ?? 0,
						),
					}))
					.sort((a, b) => a.name.localeCompare(b.name))
			: [];
		context.candidates = candidates;
		context.accepted = String(this.#weapon.system?.acceptsAmmo ?? "");
		return context;
	}

	/** Load the row's item into the launcher and close. */
	static async #pick(
		this: InstanceType<typeof OrdnancePicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.itemId;
		if (!itemId || !this.actor.items.get(itemId)) return;
		await loadOrdnance(this.#weapon, itemId);
		this.close();
	}
}