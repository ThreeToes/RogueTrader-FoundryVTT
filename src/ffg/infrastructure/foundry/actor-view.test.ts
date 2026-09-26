import { describe, expect, test } from "bun:test";
import { buildActorView } from "../../../ffg/domain/model/build";
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

describe("actorView per-system instantiation (h2uo)", () => {
	test("default instantiation keeps the full RT system view", () => {
		const view = actorView(
			fakeActor({
				system: {
					characteristics: {},
					psyRating: 3,
					voidShields: 2,
					size: "colossal",
				},
			}),
		);
		expect(view.system.psyRating).toBe(3);
		expect(view.system.voidShields).toBe(2);
		expect(view.system.size).toBe("colossal");
	});

	test("narrows to a system-supplied SystemView at compile time", () => {
		type Dh2System = {
			characteristics: Record<string, { value: number; unnatural: number }>;
			fateReserve?: number;
		};
		const view = actorView<Dh2System>(
			fakeActor({
				system: {
					characteristics: { ws: { value: 35, unnatural: 0 } },
					fateReserve: 3,
				},
			}),
		);
		expect(view.system.fateReserve).toBe(3);
		// RT-only fields do not exist on the narrow view (compile-time check).
		const leak =
			// @ts-expect-error ship fields leak nothing into sibling systems
			view.system.voidShields;
		expect(leak).toBeUndefined();
	});

	test("buildActorView is generic the same way", () => {
		type ShipSystem = {
			characteristics: Record<string, never>;
			hullIntegrity?: { value?: number; max?: number };
		};
		const view = buildActorView<ShipSystem>({
			system: { characteristics: {}, hullIntegrity: { value: 30, max: 30 } },
		});
		expect(view.system.hullIntegrity?.value).toBe(30);
		const leak =
			// @ts-expect-error psyRating is RT-character, not part of the ship view
			view.system.psyRating;
		expect(leak).toBeUndefined();
	});
});
