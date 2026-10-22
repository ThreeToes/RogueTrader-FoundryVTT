import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { getPorts } from "../../infrastructure/foundry/ports";
import { OwnedItemPicker } from "../actor/owned-picker";
import { grantedClonePayload } from "../clone-doc";
import { sheetContext } from "../context";
import { getPackDocuments, resolvePackDocument } from "../pack-resolve";
import { installMod, removeMod } from "./weapon-mods";

// One row of the picker is {id?, uuid?, name, upgrades, owned} — structural
// object literals, no interface (the template reads it directly).

/**
 * Weapon-modification picker (bead huaf): lists the owning actor's own
 * weapon-modification items PLUS the pack's modification catalogue; picking a
 * pack row clones it onto the actor first (drop-on-inventory semantics). The
 * pick attaches via the weapon's `system.modifications` id list — the
 * loadedAmmoId pattern at array strength. Drag-onto-weapon-sheet remains the
 * second affordance (WeaponSheet._onDrop).
 */

/** Structural shape of the weapon the picker attaches to. */
interface WeaponModHost {
	type?: string;
	name?: string;
	actor?: foundry.documents.Actor | null;
	system?: { modifications?: string[] };
	update?: (data: object) => Promise<void>;
}

/** One row of the picker: owned item or pack catalogue doc. */
const MOD_ITEM_TYPE = "weapon-modification";

export class ModPicker extends OwnedItemPicker {
	/** The weapon receiving the attachment. */
	#weapon: WeaponModHost;

	constructor(options: {
		actor: foundry.documents.Actor;
		weapon: WeaponModHost;
	}) {
		super(options);
		this.#weapon = options.weapon;
	}

	static DEFAULT_OPTIONS = OwnedItemPicker.pickerOptions({
		id: "rogue-trader-mod-picker",
		slug: "mod-picker",
		titleKey: "WEAPON.MOD_PICKER_TITLE",
		width: 400,
		height: 420,
		actions: {
			pickOwned: ModPicker.#pickOwned,
			pickPack: ModPicker.#pickPack,
			detach: ModPicker.#detach,
		},
	});

	static PARTS = {
		form: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/mod-picker.hbs`,
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
		const ownId = (item: { id?: string | null }) => item.id ?? "";
		const ownedIds = new Set(
			this.#weapon.system?.modifications?.map((id) => String(id ?? "")) ?? [],
		);
		// The actor's own modification items.
		const owned = this.actor.items
			.filter((item) => (item.type as string) === MOD_ITEM_TYPE)
			.map((item) => ({
				id: ownId(item),
				name: item.name ?? "",
				upgrades: String(
					(item.system as { upgrades?: string } | undefined)?.upgrades ?? "",
				),
				owned: true,
				attached: ownedIds.has(ownId(item)),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		// The pack catalogue (content-optional: a missing pack lists nothing).
		const docs = (await getPackDocuments("rogue-trader.equipment")) as Array<{
			uuid?: string;
			name?: string;
			type?: string;
			system?: { upgrades?: string };
		}>;
		const packRows = docs
			.filter((doc) => doc.type === MOD_ITEM_TYPE)
			.map((doc) => ({
				uuid: doc.uuid ?? "",
				name: doc.name ?? "",
				upgrades: String(doc.system?.upgrades ?? ""),
				owned: false,
				ownedAlready: owned.some((row) => row.name === doc.name),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		context.mods = owned;
		context.packMods = packRows;
		return context;
	}

	/** Attach an owned row. */
	static async #pickOwned(
		this: InstanceType<typeof ModPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.itemId ?? "";
		if (!itemId || !this.actor.items.get(itemId)) return;
		await installMod(this.#weapon, itemId, (id) =>
			Boolean(this.actor.items.get(id)),
		);
		this.close();
	}

	/** Attach a pack row: clone the pack doc (its full system data), then attach the clone. */
	static async #pickPack(
		this: InstanceType<typeof ModPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid ?? "";
		if (!uuid) return;
		// Bead q6eo: resolvePackDocument (the port path) instead of
		// foundry.utils.fromUuidSync — the generic resolver silently returns
		// undefined in-world for our LevelDB packs (bead wwuc), which is exactly
		// the quiet-install-nothing this branch warns about.
		const doc = (await resolvePackDocument(uuid)) as {
			toObject?: () => object;
			system?: Record<string, unknown>;
		} | null;
		if (!doc?.toObject) {
			// Loud: a stale row must never quietly install nothing.
			getPorts().notify.warn("WEAPON.MOD_CLONE_FAILED");
			return;
		}
		// Shared grantedClonePayload (bead lnya): the grantedBy stamp the old
		// hand-rolled copy had, PLUS the pack doc's _id strip it was missing
		// (repo convention: two Items cannot share an _id).
		const payload = grantedClonePayload(
			doc.toObject() as unknown as {
				_id?: unknown;
				system: Record<string, unknown>;
			},
			"mod-picker",
		);
		const created = (await this.actor.createEmbeddedDocuments("Item", [
			payload,
		] as never)) as Array<{ id?: string }>;
		const itemId = created?.[0]?.id ?? "";
		if (!itemId) {
			// Loud: the clone must never silently not exist.
			getPorts().notify.warn("WEAPON.MOD_CLONE_FAILED");
			return;
		}
		await installMod(this.#weapon, itemId, (id) =>
			Boolean(this.actor.items.get(id)),
		);
		this.close();
	}

	/** Unattach a row (the item itself stays owned; deleting is manual). */
	static async #detach(
		this: InstanceType<typeof ModPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.itemId ?? "";
		if (!itemId) return;
		await removeMod(this.#weapon, itemId, (id) =>
			Boolean(this.actor.items.get(id)),
		);
		this.close();
	}
}
