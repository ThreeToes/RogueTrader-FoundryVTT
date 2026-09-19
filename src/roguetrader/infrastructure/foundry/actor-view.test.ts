import { describe, expect, test } from "bun:test";
import { actorView } from "./actor-view";

// The builder is the one place that reads Foundry document shape for the rules
// layer. These tests pin the mapping with loose fakes (the real documents are
// structurally identical for the fields we read).

function fakeActor(overrides: Record<string, unknown> = {}) {
	return {
		id: "a1",
		uuid: "Actor.a1",
		name: "Test",
		type: "explorer",
		system: {
			characteristics: { ws: { value: 40, unnatural: 1 } },
			psyker: true,
		},
		items: [],
		effects: [],
		appliedEffects: [],
		...overrides,
	} as never;
}

describe("actorView builder (epic kof0, phase 1)", () => {
	test("maps identity, system and characteristics", () => {
		const view = actorView(fakeActor());
		expect(view.id).toBe("a1");
		expect(view.uuid).toBe("Actor.a1");
		expect(view.type).toBe("explorer");
		expect(view.system.psyker).toBe(true);
		expect(view.characteristics.ws?.value).toBe(40);
	});

	test("maps items with equip state, effects, specials and attack", () => {
		const view = actorView(
			fakeActor({
				items: [
					{
						id: "w1",
						name: "Chainsword",
						type: "melee-weapon",
						system: {
							equipState: "carried",
							damage: "1d10+3",
							special: ["tearing"],
							effects: [{ kind: "damage-flat", value: 2 }],
						},
					},
					{ id: "g1", name: "Backpack", type: "gear", system: {} },
				],
			}),
		);
		expect(view.items).toHaveLength(2);
		const sword = view.items[0];
		expect(sword?.equipState).toBe("carried");
		expect(sword?.special).toEqual(["tearing"]);
		expect(sword?.effects).toEqual([{ kind: "damage-flat", value: 2 }]);
		expect(sword?.attack?.characteristic).toBe("ws");
		expect(view.items[1]?.attack).toBeNull();
		expect(view.items[1]?.equipState).toBe("stowed");
	});

	test("maps effects and appliedEffects", () => {
		const view = actorView(
			fakeActor({
				effects: [
					{
						id: "fx1",
						name: "Frozen",
						statuses: ["frozen"],
						flags: { "rogue-trader": { snapOut: true } },
						changes: [{ key: "system.testModifier", value: -30 }],
					},
				],
				appliedEffects: [{ id: "fx2", name: "Inspired" }],
			}),
		);
		expect(view.effects[0]?.snapOut).toBe(true);
		expect(view.effects[0]?.changes[0]?.value).toBe(-30);
		expect(view.appliedEffects.map((e) => e.id)).toEqual(["fx2"]);
	});

	test("is defensive about missing collections and fields", () => {
		const view = actorView({
			id: "a2",
			name: "Sparse",
			type: "vehicle",
			system: {},
		} as never);
		expect(view.items).toEqual([]);
		expect(view.effects).toEqual([]);
		expect(view.appliedEffects).toEqual([]);
		expect(view.characteristics).toEqual({});
	});
});
