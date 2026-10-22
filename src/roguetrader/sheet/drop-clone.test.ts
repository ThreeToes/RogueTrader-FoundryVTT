import { describe, expect, test } from "bun:test";
import { foundryPorts } from "../../ffg/infrastructure/foundry/ports";
import { MINIMAL_FOUNDRY } from "../../test-helpers/foundry-schema-stub";
import { cloneItemIntoActor, npcEquipDefault } from "./drop-clone";

// Bead meb2: shared drop-to-clone helper. The NPC equip-default rule
// (owner spec): dropped weapons arrive carried, armour worn, rest stowed.
describe("npcEquipDefault (bead meb2)", () => {
	test("weapons arrive carried", () => {
		expect(npcEquipDefault("melee-weapon")).toBe("carried");
		expect(npcEquipDefault("ranged-weapon")).toBe("carried");
	});
	test("armour arrives worn", () => {
		expect(npcEquipDefault("armour")).toBe("worn");
	});
	test("everything else stows", () => {
		expect(npcEquipDefault("gear")).toBe("stowed");
		expect(npcEquipDefault("")).toBe("stowed");
	});
});

// ---------------------------------------------------------------------------
// Bead 27eu — the duplicated-drop scenario, stubbing Foundry per
// affliction-drop.test.ts: the SAME pack doc resolves on every drop;
// the skipOwned check is uuid-based, so the SECOND drop of the same pack item
// past it must still create a document WITHOUT the pack `_id`.
//
// Bead q6eo: the clone resolves through resolvePackDocument (the ContentPort
// path — fromUuid silently no-ops for our LevelDB packs in-world), so the
// stub drives the PORT (setPorts with a content.document fake) instead of
// foundry.utils.fromUuid. The foundry.documents.Item class stays stubbed —
// cloneItemIntoActor still gates on `instanceof foundry.documents.Item`.
// ---------------------------------------------------------------------------

describe("cloneItemIntoActor pack-_id strip (bead 27eu)", () => {
	test("dropping the same pack item twice creates docs without the pack _id", async () => {
		class FakeItem {
			_id: string;
			uuid: string;
			name: string;
			type: string;
			system: Record<string, unknown>;
			constructor(data: {
				_id: string;
				uuid: string;
				name: string;
				type: string;
				system?: Record<string, unknown>;
			}) {
				this._id = data._id;
				this.uuid = data.uuid;
				this.name = data.name;
				this.type = data.type;
				this.system = { ...(data.system ?? {}) };
			}
			// Document semantics: a fresh object each call, so the settled clone
			// cannot corrupt the pack entry.
			toObject(): Record<string, unknown> {
				return {
					_id: this._id,
					uuid: this.uuid,
					name: this.name,
					type: this.type,
					system: { ...this.system },
				};
			}
		}

		// The SAME pack document — two drops, one uuid, one stored _id.
		const source = new FakeItem({
			_id: "pack-item-1",
			uuid: "Compendium.rogue-trader.weapons.Item.pack-item-1",
			name: "Chain Sword",
			type: "melee-weapon",
			system: { damage: "1d10+4", equipState: "stowed" },
		});

		const createdPayloads: Array<Record<string, unknown>> = [];
		const actor = {
			items: [],
			createEmbeddedDocuments: async (
				_type: string,
				data: Array<Record<string, unknown>>,
			) => {
				createdPayloads.push(...data);
				return data.map((d, i) => ({ ...d, id: `new-${i}` }));
			},
		};

		const originalFoundry = (globalThis as Record<string, unknown>).foundry;
		(globalThis as Record<string, unknown>).foundry = {
			...((originalFoundry as object) ?? MINIMAL_FOUNDRY),
			documents: { Item: FakeItem },
		};
		const { setPorts, resetPorts } = await import(
			"../../ffg/infrastructure/foundry/ports"
		);
		// Bead q6eo: the resolution path is the port now, so the fake pack doc
		// is served by a content.document stub (the SAME doc on every call).
		setPorts({
			...foundryPorts,
			content: {
				...foundryPorts.content,
				document: async () => source,
			},
		});
		try {
			const first = await cloneItemIntoActor(
				actor as never,
				"Compendium.rogue-trader.weapons.Item.pack-item-1",
			);
			expect(first?.name).toBe("Chain Sword");
			// The uuid-based skipOwned check only sees items ALREADY on the
			// actor — the second drop of the same pack Item slips past it and
			// clones again (the scenario the gap lives in).
			const second = await cloneItemIntoActor(
				actor as never,
				"Compendium.rogue-trader.weapons.Item.pack-item-1",
			);
			expect(second?.name).toBe("Chain Sword");
		} finally {
			// Restore to the minimal floor, never delete — a deleted global
			// poisons the later suites in this bun process (packless-CI class).
			(globalThis as Record<string, unknown>).foundry =
				originalFoundry ?? MINIMAL_FOUNDRY;
			resetPorts();
		}
		// BOTH creations ran, and NEITHER payload carries the pack _id —
		// previously the second clone would have arrived with `_id: pack-item-1`.
		expect(createdPayloads).toHaveLength(2);
		for (const payload of createdPayloads) {
			expect(payload._id).toBeUndefined();
		}
		expect(createdPayloads[0]?.name).toBe("Chain Sword");
		// The system data still merges through (the strip is payload-only).
		expect(createdPayloads[0]?.system).toMatchObject({ damage: "1d10+4" });
	});
});
