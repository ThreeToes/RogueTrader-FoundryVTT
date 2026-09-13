import { PlanetActor } from "../../data/actor/planet-actor";
import { RtActorSheet } from "../context";

/** Attached game-table row rendered on the planet sheet. */
interface AttachedTable {
	uuid: string;
	name: string;
	kind: string;
	kindLabel: string;
	roll: string;
	summary: string;
}

/**
 * Planet sheet (owner ask): SOI world record — the headline profile fields
 * plus the attached `game-table` documents (dragged from the gametables
 * compendium). Attached tables group by kind and render read-only; the
 * authoritative row texts live on the items. Fully resizable.
 */
export class PlanetSheet extends RtActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "planet"],
		position: { width: 560, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			removeTable: PlanetSheet.#onRemoveTable,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/planet-header.hbs",
		},
		form: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/planet.hbs",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("PLANET.HEADER")}: ${this.document.name}`;
	}

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as PlanetActor;
		const profile = (
			[
				["body", "PLANET.BODY"],
				["gravity", "PLANET.GRAVITY"],
				["orbitalFeature", "PLANET.ORBITAL"],
				["atmosphere", "PLANET.ATMOSPHERE"],
				["climate", "PLANET.CLIMATE"],
				["habitability", "PLANET.HABITABILITY"],
				["inhabitants", "PLANET.INHABITANTS"],
				["development", "PLANET.DEVELOPMENT"],
				["territories", "PLANET.TERRITORIES"],
			] as Array<[keyof PlanetActor, string]>
		)
			.map(([key, labelKey]) => ({
				key: key as string,
				name: `system.${key as string}`,
				label: game.i18n.localize(labelKey),
				value: String(system[key] ?? ""),
			}))
			// Only render profile rows the GM has actually filled in.
			.filter((f) => f.value !== "" || this.document.isOwner);
		context.profile = profile;
		// Attached tables (game-table items), grouped by kind.
		const attached: AttachedTable[] = [];
		for (const item of this.document.items) {
			if (item.type !== "game-table") continue;
			const sys = item.system as unknown as { kind?: string; roll?: string };
			const kind = String(sys.kind ?? "");
			attached.push({
				uuid: item.uuid,
				name: item.name ?? "",
				kind,
				kindLabel: PlanetSheet.#kindLabel(kind),
				roll: String(sys.roll ?? ""),
				summary: String(
					(item.system as unknown as { shortDescription?: string })
						.shortDescription ?? "",
				),
			});
		}
		// Group by kind label, preserving compendium order within groups.
		const groups = new Map<string, AttachedTable[]>();
		for (const t of attached) {
			const list = groups.get(t.kindLabel) ?? [];
			list.push(t);
			groups.set(t.kindLabel, list);
		}
		context.attachedGroups = [...groups.entries()].map(([label, tables]) => ({
			label,
			tables,
		}));
		context.notesHTML = await foundry.applications.ux.TextEditor.enrichHTML(
			system.notes ?? "",
			{ relativeTo: this.document },
		);
		return context;
	}

	/** Attach dropped `game-table` documents; every other drop is a no-op. */
	protected override async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return undefined;
		const source = await foundry.utils.fromUuid(data.uuid);
		// Planet-attach contract: only game-table documents stick.
		if (!(source instanceof foundry.documents.Item)) return undefined;
		if (source.type !== "game-table") return undefined;
		if (this.document.items.find((i) => i.uuid === source.uuid)) {
			return undefined;
		}
		const payload = source.toObject() as {
			system?: Record<string, unknown>;
		};
		const created = (await (
			this.document as unknown as {
				createEmbeddedDocuments: (
					type: string,
					payloads: unknown[],
				) => Promise<foundry.documents.Item[]>;
			}
		).createEmbeddedDocuments("Item", [payload])) as foundry.documents.Item[];
		return created[0];
	}

	/** Prettify a table kind key ("soi-body" → "Soi Body") for grouping. */
	static #kindLabel(kind: string): string {
		if (!kind) return game.i18n.localize("GAME_TABLE.KIND_OTHER");
		const key = `GAME_TABLE_KIND.${kind}`;
		const localized = game.i18n.has(key)
			? game.i18n.localize(key)
			: kind
					.replace(/^soi-/, "")
					.replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
		return localized;
	}

	/** Detach an attached table (owner ask: attach AND remove). */
	static async #onRemoveTable(this: PlanetSheet, event: MouseEvent) {
		const target = (event.currentTarget as HTMLElement | null)?.closest(
			"[data-item-uuid]",
		);
		const uuid = target?.getAttribute("data-item-uuid");
		if (!uuid) return;
		const item = (this.document as unknown as {
			items: Map<string, foundry.documents.Item>;
		}).items.get(uuid);
		if (!item) return;
		await item.delete();
	}
}