/**
 * The REAL Foundry ContentPort implementation (bead c3hh).
 *
 * Every other ContentPort consumer injects NO_CONTENT_PORT or a hand-written
 * fake, so content.ts' real code paths were never exercised. This file pins
 * them against a stubbed `game.packs`, the way ports.test.ts stubs the
 * Foundry globals:
 *
 *  • `packDocuments`' null-vs-[] distinction (beads p7o5/s4lu) — a missing
 *    pack is NULL through documentsOrNull and [] through documents();
 *  • `find` by name (and the null → [] collapse behind it);
 *  • `resolveDocument`'s Compendium-uuid fast path (bead wwuc) — the one that
 *    must NOT fall through to foundry.utils.fromUuid, which resolves to
 *    undefined in-world for our LevelDB comps.
 *
 * The globals are installed per-test through dynamic imports because bun runs
 * every suite in ONE process (ports.ts touches the Foundry implementation set
 * at load) — the same pattern ports.test.ts uses.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ContentTable } from "../../application/ports";

/** A minimal Compendium-shaped document: the rules read `name` and `type`. */
interface StubDoc {
	name?: string;
	type?: string;
	id?: string;
}

interface StubPack {
	documents: StubDoc[];
	/** Documents addressable by id, for the Compendium-uuid fast path. */
	byId?: Record<string, StubDoc>;
}

/** The globals the stub swaps in, restored after the suite. */
const originalGame = (globalThis as Record<string, unknown>).game;
const originalFoundry = (globalThis as Record<string, unknown>).foundry;
const originalWarn = console.warn;

afterAll(() => {
	(globalThis as Record<string, unknown>).game = originalGame;
	(globalThis as Record<string, unknown>).foundry = originalFoundry;
	console.warn = originalWarn;
});

/** Every console.warn line the port emitted during the current test. */
let warns: string[] = [];

afterEach(() => {
	warns = [];
	console.warn = originalWarn;
});

/** What a Compendium stub records, so lookups can be asserted. */
interface World {
	packGets: string[];
	getDocumentIds: string[];
	documentCalls: number;
}

/**
 * Install a stub world: `packs` keyed by compendium id, plus a fromUuid stand-in
 * (which THROWS by default so a fall-through from the uuid fast path is loud).
 */
function stubWorld(
	packs: Record<string, StubPack>,
	fromUuid: (uuid: string) => unknown = () => {
		throw new Error("fromUuid must not be called");
	},
): World {
	const world: World = { packGets: [], getDocumentIds: [], documentCalls: 0 };
	(globalThis as Record<string, unknown>).game = {
		packs: {
			get: (id: string) => {
				world.packGets.push(id);
				const pack = packs[id];
				if (!pack) return undefined;
				return {
					getDocuments: async () => {
						world.documentCalls++;
						return pack.documents;
					},
					getDocument: async (docId: string) => {
						world.getDocumentIds.push(docId);
						return pack.byId?.[docId];
					},
				};
			},
		},
	};
	(globalThis as Record<string, unknown>).foundry = {
		utils: { fromUuid },
	};
	return world;
}

describe("the real ContentPort (bead c3hh)", () => {
	// --- the null-vs-[] distinction (beads p7o5/s4lu) -----------------------

	test("documentsOrNull resolves null for a pack that is not installed", async () => {
		const { foundryContent } = await import("./content");
		const world = stubWorld({ "rogue-trader.critical-tables": { documents: [] } });
		expect(await foundryContent.documentsOrNull("rogue-trader.character-options")).toBeNull();
		// The lookup went through game.packs exactly once, with the given id.
		expect(world.packGets).toEqual(["rogue-trader.character-options"]);
		// A null pack never loaded documents (no getDocuments call).
		expect(world.documentCalls).toBe(0);
	});

	test("documents collapses the same missing pack to [] instead of null", async () => {
		const { foundryContent } = await import("./content");
		stubWorld({ "rogue-trader.critical-tables": { documents: [] } });
		expect(await foundryContent.documents("rogue-trader.character-options")).toEqual([]);
	});

	test("an installed pack's documents come through from game.packs.get", async () => {
		const { foundryContent } = await import("./content");
		const docs: StubDoc[] = [{ name: "Death's Doorstep", type: "RollTable" }];
		stubWorld({ "rogue-trader.critical-tables": { documents: docs } });
		expect(await foundryContent.documentsOrNull("rogue-trader.critical-tables")).toEqual(docs);
		expect(await foundryContent.documents("rogue-trader.critical-tables")).toEqual(docs);
	});

	// --- find(): by name, over the null → [] collapse ------------------------

	test("find returns the document whose name matches", async () => {
		const { foundryContent } = await import("./content");
		const doc: StubDoc = { name: "Death's Doorstep", type: "RollTable" };
		stubWorld({ "rogue-trader.critical-tables": { documents: [doc] } });
		const found = (await foundryContent.find(
			"rogue-trader.critical-tables",
			"Death's Doorstep",
		)) as ContentTable;
		expect(found).toBe(doc as unknown as ContentTable);
	});

	test("find resolves null for a name the pack does not hold", async () => {
		const { foundryContent } = await import("./content");
		stubWorld({
			"rogue-trader.critical-tables": {
				documents: [{ name: "Death's Doorstep", type: "RollTable" }],
			},
		});
		expect(
			await foundryContent.find("rogue-trader.critical-tables", "Battle Suit Hit"),
		).toBeNull();
	});

	test("find on a pack that is not installed resolves null (no throw)", async () => {
		const { foundryContent } = await import("./content");
		stubWorld({ "rogue-trader.critical-tables": { documents: [] } });
		expect(await foundryContent.find("absent.pack", "Death's Doorstep")).toBeNull();
	});

	// --- document(): the Compendium-uuid fast path (bead wwuc) ---------------

	test("a Compendium uuid resolves DIRECTLY from the pack, never fromUuid", async () => {
		const { foundryContent } = await import("./content");
		const doc: StubDoc = { id: "Abc123", name: "Eye of the Storm" };
		const world = stubWorld({
			"rogue-trader.critical-tables": { documents: [doc], byId: { Abc123: doc } },
		});
		// fromUuid THROWS here (the stubWorld default): if the fast path fell
		// through to it, this test would throw — the wwuc LevelDB bug.
		const resolved = await foundryContent.document(
			"Compendium.rogue-trader.critical-tables.Item.Abc123",
		);
		expect(resolved).toBe(doc);
		// Exactly one pack lookup, by `<source>.<pack>` — not the whole uuid.
		expect(world.packGets).toEqual(["rogue-trader.critical-tables"]);
		expect(world.getDocumentIds).toEqual(["Abc123"]);
	});

	test("a Compendium uuid whose pack is absent warns and resolves null", async () => {
		const { foundryContent } = await import("./content");
		const world = stubWorld({});
		console.warn = (message?: unknown) => {
			warns.push(String(message));
		};
		const resolved = await foundryContent.document(
			"Compendium.rogue-trader.absent.Item.Abc123",
		);
		expect(resolved).toBeNull();
		// The loud missing-pack warn (bead p7o5 semantics) names the pack id.
		expect(warns.some((line) => line.includes("rogue-trader.absent not found"))).toBe(true);
		// No generic fromUuid fall-through for a compendium-shaped uuid.
		expect(world.packGets).toEqual(["rogue-trader.absent"]);
	});

	test("a Compendium uuid whose document is missing warns and resolves null", async () => {
		const { foundryContent } = await import("./content");
		stubWorld({
			"rogue-trader.critical-tables": {
				documents: [],
				// byId deliberately empty: getDocument resolves undefined.
			},
		});
		console.warn = (message?: unknown) => {
			warns.push(String(message));
		};
		const resolved = await foundryContent.document(
			"Compendium.rogue-trader.critical-tables.Item.Gone404",
		);
		expect(resolved).toBeNull();
		expect(
			warns.some((line) =>
				line.includes("pack document Gone404 not found in rogue-trader.critical-tables"),
			),
		).toBe(true);
	});

	test("a non-compendium uuid falls through to foundry.utils.fromUuid", async () => {
		const { foundryContent } = await import("./content");
		const doc: StubDoc = { id: "actor-lachlan", name: "Lachlan" };
		const world = stubWorld({}, async (uuid) => {
			return uuid === "Actor.actor-lachlan" ? doc : null;
		});
		expect(await foundryContent.document("Actor.actor-lachlan")).toBe(doc);
		expect(world.packGets).toEqual([]);
	});

	test("a uuid fromUuid resolves to nothing hands back null", async () => {
		const { foundryContent } = await import("./content");
		stubWorld({}, async () => null);
		expect(await foundryContent.document("Actor.deleted")).toBeNull();
	});
});

