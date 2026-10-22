// Bead usw3: the four remaining drop surfaces (character-sheet, cache-sheet,
// planet-sheet, vehicle-sheet) used to resolve dropped Items via raw
// foundry.utils.fromUuid, which silently no-ops for this system's LevelDB
// compendium packs in-world (the bead wwuc class) — dropping a compendium
// Item did NOTHING. They now resolve through resolvePackDocument (the
// ContentPort path, the q6eo conversion that drop-clone/weapon-sheet/
// mod-picker already took).
//
// These tests pin that routing: the drop path is driven by a
// content.document stub (drop-clone.test.ts pattern — setPorts, restore on
// exit) and the dragged uuid must reach the PORT, a fromUuid stub would have
// stayed empty. The instanceof-Item guard semantics are kept on every
// surface: a world-document uuid still reaches the port and passes the same
// guard here — NOTE this pin exercises PORT ROUTING, not the adapter's own
// fromUuid fallback internals.
//
// The stub-module import follows character-sheet-scrollable.test.ts (sheet
// modules touch the foundry global at load); no Foundry application is
// instantiated — each _onDrop runs against a minimal fake `this`.
import { afterAll, afterEach, describe, expect, test } from "bun:test";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG", "Handlebars"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = { i18n: { localize: (key: string) => key } };
globals.Handlebars = { registerPartial: () => undefined };

/** The drag payload TextEditor.getDragEventData answers for each test. */
let currentDrop: { type?: string; uuid?: string } = {};

/** An Item-shaped document: instanceof-able against the stubbed class. */
class FakeItem {
	uuid: string;
	name: string;
	type: string;
	system: Record<string, unknown>;
	constructor(data: {
		uuid: string;
		name: string;
		type: string;
		system?: Record<string, unknown>;
	}) {
		this.uuid = data.uuid;
		this.name = data.name;
		this.type = data.type;
		this.system = { ...(data.system ?? {}) };
	}
	toObject(): Record<string, unknown> {
		return {
			_id: "pack-item-1",
			uuid: this.uuid,
			name: this.name,
			type: this.type,
			system: { ...this.system },
		};
	}
}

globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		sheets: { ActorSheetV2: class {} },
		ux: { TextEditor: { getDragEventData: () => currentDrop } },
	},
	abstract: { TypeDataModel: class {} },
	documents: { Item: FakeItem, Actor: class {} },
};

const { CharacterSheet } = await import("./character-sheet");
const { CacheSheet } = await import("./cache-sheet");
const { PlanetSheet } = await import("./planet-sheet");
const { VehicleSheet } = await import("./vehicle-sheet");
const { foundryPorts, setPorts, resetPorts } = await import(
	"../../../ffg/infrastructure/foundry/ports"
);

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

afterEach(() => {
	resetPorts();
	currentDrop = {};
});

/** Serve `source` from a content.document stub; return the uuids asked. */
function servePackDoc(source: unknown): string[] {
	const asked: string[] = [];
	setPorts({
		...foundryPorts,
		content: {
			...foundryPorts.content,
			document: async (uuid: string) => {
				asked.push(uuid);
				return source;
			},
		},
	});
	return asked;
}

/**
 * _onDrop is protected; run it against a fake `this` (no Foundry sheet is
 * instantiated) via a widened prototype view.
 */
type DropCapable = {
	_onDrop: (event: DragEvent) => Promise<unknown>;
};
function drop(prototype: unknown, fakeThis: object): Promise<unknown> {
	return (prototype as unknown as DropCapable)._onDrop.call(
		fakeThis,
		{} as DragEvent,
	);
}

/** A sheet-less actor/document creation sink: records embedded payloads. */
function creationSink(): {
	payloads: Array<Record<string, unknown>>;
	createEmbeddedDocuments: (
		type: string,
		data: Array<Record<string, unknown>>,
	) => Promise<unknown>;
} {
	const payloads: Array<Record<string, unknown>> = [];
	return {
		payloads,
		createEmbeddedDocuments: async (
			_type: string,
			data: Array<Record<string, unknown>>,
		) => {
			payloads.push(...data);
			return data.map((d, i) => ({ ...d, id: `new-${i}` }));
		},
	};
}

describe("pack drop surfaces resolve through the ContentPort (bead usw3)", () => {
	test("CharacterSheet._onDrop clones a dropped pack Item into the inventory", async () => {
		const source = new FakeItem({
			uuid: "Compendium.rogue-trader.character-options.Item.smite",
			name: "Smite",
			type: "talent",
		});
		const asked = servePackDoc(source);
		const sink = creationSink();
		const actor = { items: [], ...sink };

		currentDrop = {
			type: "Item",
			uuid: "Compendium.rogue-trader.character-options.Item.smite",
		};
		await drop(CharacterSheet.prototype, { actor });

		// The dragged uuid reached the PORT (a fromUuid stub would stay empty).
		expect(asked).toEqual([
			"Compendium.rogue-trader.character-options.Item.smite",
		]);
		expect(sink.payloads).toHaveLength(1);
		expect(sink.payloads[0].name).toBe("Smite");
		// The _id strip (bead 27eu convention): a pack doc's _id must NOT ride
		// along into the embedded clone.
		expect(sink.payloads[0]._id).toBeUndefined();

		// A world-document uuid must keep resolving to the same guard too —
		// again a PORT-ROUTING pin, not the adapter's own fromUuid fallback.
		const worldSink = creationSink();
		currentDrop = { type: "Item", uuid: "Item.world-weapon" };
		await drop(CharacterSheet.prototype, {
			actor: { items: [], ...worldSink },
		});
		expect(asked).toContain("Item.world-weapon");
		expect(worldSink.payloads).toHaveLength(1);
	});

	test("CacheSheet._onDrop lets the GM stock a cache from a compendium", async () => {
		const source = new FakeItem({
			uuid: "Compendium.rogue-trader.gear.Item.lasgun",
			name: "Lasgun",
			type: "gear",
		});
		const asked = servePackDoc(source);
		const sink = creationSink();
		const fakeThis = {
			isEditable: true,
			document: { items: [], ...sink },
		};

		currentDrop = {
			type: "Item",
			uuid: "Compendium.rogue-trader.gear.Item.lasgun",
		};
		await drop(CacheSheet.prototype, fakeThis);

		expect(asked).toEqual(["Compendium.rogue-trader.gear.Item.lasgun"]);
		expect(sink.payloads).toHaveLength(1);
		expect(sink.payloads[0].name).toBe("Lasgun");
		// The _id strip must hold here too (the same pack entry stocked twice
		// would otherwise clone a duplicate _id into one cache).
		expect(sink.payloads[0]._id).toBeUndefined();
	});

	test("PlanetSheet._onDrop attaches only game-table drops", async () => {
		const table = new FakeItem({
			uuid: "Compendium.rogue-trader.tables.Item.weather",
			name: "Weather",
			type: "game-table",
		});
		const asked = servePackDoc(table);
		const sink = creationSink();
		const fakeThis = { document: { items: [], ...sink } };

		currentDrop = {
			type: "Item",
			uuid: "Compendium.rogue-trader.tables.Item.weather",
		};
		await drop(PlanetSheet.prototype, fakeThis);

		expect(asked).toEqual([
			"Compendium.rogue-trader.tables.Item.weather",
		]);
		expect(sink.payloads).toHaveLength(1);
		// The _id strip must hold here too.
		expect(sink.payloads[0]._id).toBeUndefined();

		// The attach contract still holds: a non-game-table pack Item is a no-op.
		const nonTable = new FakeItem({
			uuid: "Compendium.rogue-trader.gear.Item.lasgun",
			name: "Lasgun",
			type: "gear",
		});
		servePackDoc(nonTable);
		const rejectedSink = creationSink();
		currentDrop = {
			type: "Item",
			uuid: "Compendium.rogue-trader.gear.Item.lasgun",
		};
		await drop(PlanetSheet.prototype, {
			document: { items: [], ...rejectedSink },
		});
		expect(rejectedSink.payloads).toHaveLength(0);
	});

	test("VehicleSheet._onDrop mounts a dropped weapon pack Item", async () => {
		const source = new FakeItem({
			uuid: "Compendium.rogue-trader.weapons.Item.multi-laser",
			name: "Multi-laser",
			type: "melee-weapon",
		});
		const asked = servePackDoc(source);
		const updates: Array<Record<string, unknown>> = [];
		const fakeThis = {
			document: { system: {} },
			actor: {
				update: async (update: Record<string, unknown>) => {
					updates.push(update);
				},
			},
		};

		currentDrop = {
			type: "Item",
			uuid: "Compendium.rogue-trader.weapons.Item.multi-laser",
		};
		await drop(VehicleSheet.prototype, fakeThis);

		expect(asked).toEqual([
			"Compendium.rogue-trader.weapons.Item.multi-laser",
		]);
		expect(updates).toHaveLength(1);
		expect(
			(
				(updates[0].system as { mountedWeapons: Array<Record<string, unknown>> })
					.mountedWeapons[0]
			).uuid,
		).toBe("Compendium.rogue-trader.weapons.Item.multi-laser");
	});
});