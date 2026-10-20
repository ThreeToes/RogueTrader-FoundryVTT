import { describe, expect, test } from "bun:test";
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
// affliction-drop.test.ts: fromUuid resolves the same pack doc on every drop;
// the skipOwned check is uuid-based, so the SECOND drop of the same pack item
// past it must still create a document WITHOUT the pack `_id`.
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
			utils: { fromUuid: async () => source },
			documents: { Item: FakeItem },
		};
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
			(globalThis as Record<string, unknown>).foundry = originalFoundry ?? MINIMAL_FOUNDRY;
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
