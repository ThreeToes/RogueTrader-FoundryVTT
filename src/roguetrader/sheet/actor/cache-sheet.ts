import { CacheActor } from "../../data/actor/cache";
import { actorEncumbrance } from "../../rules/encumbrance";
import { sheetContext } from "../context";
import { enrichText } from "../rich-text";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Minimal shape of an owned Item as this sheet reads it. */
interface OwnedItem {
	id?: string | null;
	uuid?: string;
	name?: string | null;
	type?: string;
	system?: { weight?: unknown };
	delete(): Promise<unknown>;
	toObject(): unknown;
}

/**
 * Cache sheet (bead wlx9): a lootable container. An inventory list and a notes
 * box, nothing else — no characteristics, no derived stats, no roll buttons.
 *
 * THE LOOTING FLOW, and why it is an explicit action rather than drag-only
 * Both routes are available, but they are not equivalent:
 *   - DRAG OUT works natively: rows are draggable and carry core
 *     {type: "Item", uuid} data (see #onDragStart), so a player can drag an
 *     item onto their own character sheet. This is Foundry's own cross-actor
 *     drop and it respects whatever ownership the target sheet enforces.
 *   - TAKE is the gated, REPORTED path. The bead asked me to verify that
 *     native drag respects permissions before relying on it, and that cannot
 *     be verified without a live world, so the flow does not DEPEND on it:
 *     Take is explicit, it names the destination, and it can refuse loudly.
 *     A silent drag failure looks exactly like a broken sheet.
 *
 * WHICH ACTOR A TAKE GOES TO: the user's assigned character (game.user.character).
 * There is no other defensible answer — "the actor whose sheet is open" is
 * often a GM's, and inventing a picker for a one-click action is worse. With no
 * assigned character the action refuses and says so, rather than guessing.
 *
 * ENCUMBRANCE IS ADVISORY, NOT A GATE. The system's model (rules/encumbrance)
 * reports ok/encumbered/over and deliberately does not block — the book's rule
 * is a penalty, not a cap — so a take is never refused for weight. It DOES warn
 * when the take pushes the taker past capacity, because that is the moment the
 * player wants to know. This routes through the same shared definition the
 * character sheet's load bar uses (actorEncumbrance), rather than a second rule.
 *
 * A CACHE NEVER ROLLS. There is no roll action here, and the model has no field
 * a Test could read. Independently, the roll pipeline refuses an actor the
 * current user does not own (bead qiuo), which a cache normally is.
 */
export class CacheSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "cache"],
		position: { width: 480, height: "auto" as const },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			takeItem: CacheSheet.#onTakeItem,
			takeAll: CacheSheet.#onTakeAll,
			deleteItem: CacheSheet.#onDeleteItem,
		},
	};

	static PARTS = {
		form: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/cache.hbs",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("CACHE.HEADER")}: ${this.document.name}`;
	}

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		const system = this.document.system as CacheActor;

		// Weight is summed here for the header only; the cache has no capacity
		// of its own (it is a container, not a vessel hold).
		const rows = this.#items().map((item) => ({
			id: item.id ?? "",
			uuid: item.uuid ?? "",
			name: item.name ?? "",
			weight: Number(
				(item.system as { weight?: unknown } | undefined)?.weight ?? 0,
			),
			typeLabel: `TYPES.Item.${item.type ?? "gear"}`,
			// Decided here rather than in the template: the shared inv-row
			// partial renders the delete anchor only when this is non-empty, and
			// a subexpression like `(if editable "deleteItem" "")` is not how
			// handlebars' `if` behaves (it takes exactly one argument).
			deleteAction: this.isEditable ? "deleteItem" : "",
		}));
		context.items = rows;
		context.totalWeight = rows.reduce((sum, r) => sum + Math.max(0, r.weight), 0);
		context.hasItems = rows.length > 0;
		// The take actions need somewhere to put the loot. Surfaced so the
		// buttons can be disabled with a reason instead of failing on click.
		context.takerName = CacheSheet.#taker()?.name ?? "";
		context.canTake = Boolean(context.takerName);
		context.notesHTML = await enrichText(system.notes ?? "", this.document);
		return context;
	}

	#items(): OwnedItem[] {
		return [...this.document.items] as unknown as OwnedItem[];
	}

	/**
	 * The actor a take goes to: the user's assigned character.
	 *
	 * Deliberately NOT `game.user.isGM ? <something>`: a GM has no character by
	 * default, and quietly picking one for them would move loot onto the wrong
	 * sheet. A GM who wants to loot assigns a character, or drags.
	 */
	static #taker(): { name: string; createEmbeddedDocuments?: unknown } | null {
		return (
			(game as unknown as { user?: { character?: { name: string } | null } }).user
				?.character ?? null
		);
	}

	/** Drag an item row out; core {type, uuid} data so other sheets accept it. */
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

	/** Drop an external Item in (GM stocking the cache). */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		if (!this.isEditable) return undefined;
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return undefined;
		const source = await foundry.utils.fromUuid(data.uuid);
		if (!(source instanceof foundry.documents.Item)) return undefined;
		if (this.document.items.find((item) => item.uuid === source.uuid)) {
			return undefined;
		}
		return (
			this.document as unknown as {
				createEmbeddedDocuments: (
					type: string,
					payloads: unknown[],
				) => Promise<unknown>;
			}
		).createEmbeddedDocuments("Item", [
			(source as unknown as { toObject(): unknown }).toObject(),
		]);
	}

	/** Remove an item from the cache (GM only — the sheet is not editable for players). */
	static async #onDeleteItem(this: CacheSheet, event: MouseEvent): Promise<void> {
		if (!this.isEditable) return;
		const id = (event.currentTarget as HTMLElement | null)?.dataset.itemId;
		if (!id) return;
		const item = this.#items().find((i) => i.id === id);
		await item?.delete();
	}

	/** Take one item to the user's character. */
	static async #onTakeItem(this: CacheSheet, event: MouseEvent): Promise<void> {
		const uuid = (event.currentTarget as HTMLElement | null)?.dataset.itemUuid;
		if (!uuid) return;
		await CacheSheet.#take(this, [uuid]);
	}

	/** Take everything the taker can carry. */
	static async #onTakeAll(this: CacheSheet): Promise<void> {
		await CacheSheet.#take(
			this,
			this.#items()
				.map((i) => i.uuid ?? "")
				.filter(Boolean),
		);
	}

	/**
	 * Move items from the cache onto the user's character.
	 *
	 * CREATE FIRST, THEN DELETE. If the create fails the item stays in the
	 * cache — losing loot is worse than a refused take, and the reverse order
	 * would destroy it on any error.
	 */
	static async #take(sheet: CacheSheet, uuids: string[]): Promise<void> {
		if (uuids.length === 0) return;
		const taker = CacheSheet.#taker() as
			| {
					name: string;
					items?: Array<{ type?: string }>;
					system?: { characteristicBonus?(key: string): number };
					createEmbeddedDocuments?: (
						type: string,
						payloads: unknown[],
					) => Promise<unknown>;
			  }
			| null;
		if (!taker?.createEmbeddedDocuments) {
			ui.notifications?.warn(game.i18n.localize("CACHE.NO_TAKER"));
			return;
		}

		const wanted = new Set(uuids);
		const items = sheet.#items().filter((i) => wanted.has(i.uuid ?? ""));
		if (items.length === 0) return;

		await taker.createEmbeddedDocuments(
			"Item",
			items.map((item) => item.toObject()),
		);
		// Only now remove them from the cache, and only the ones that moved.
		await Promise.all(items.map((item) => item.delete()));

		CacheSheet.#warnIfOverloaded(taker, items.length);
	}

	/**
	 * Warn when the take pushed the taker past capacity.
	 *
	 * NOT a refusal: the system's encumbrance model is advisory by design
	 * (rules/encumbrance reports ok/encumbered/over; the book's rule is a
	 * penalty, not a cap), so inventing a hard limit here would be a second
	 * rule. This uses the same shared definition the character sheet's load bar
	 * does, so the warning and the bar can never disagree.
	 */
	static #warnIfOverloaded(
		taker: {
			name: string;
			items?: Array<{ type?: string; system?: unknown }>;
			system?: { characteristicBonus?(key: string): number };
		},
		takenCount: number,
	): void {
		const items = taker.items ?? [];
		const bonus = Number(taker.system?.characteristicBonus?.("s") ?? 0);
		const outcome = actorEncumbrance(items, bonus);
		if (outcome.state === "ok") return;
		ui.notifications?.warn(
			game.i18n.format("CACHE.OVERLOADED", {
				actor: taker.name,
				count: String(takenCount),
				weight: String(outcome.weight),
				capacity: String(outcome.capacity),
			}),
		);
	}
}
