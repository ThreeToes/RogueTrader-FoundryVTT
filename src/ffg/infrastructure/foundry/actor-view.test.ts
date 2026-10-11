import { describe, expect, test } from "bun:test";
import type { CharacterSystemView } from "../../../ffg/domain/model/actor";
import { isCharacterView } from "../../../ffg/domain/model/actor";
import { buildActorView, type LooseActor } from "../../../ffg/domain/model/build";
import { actorView } from "./actor-view";

// The builder is the one place that reads Foundry document shape for the rules
// layer. These tests pin the mapping with loose fakes (the real documents are
// structurally identical for the fields we read).

function fakeActor(overrides: Record<string, unknown> = {}): LooseActor & {
	type: "explorer";
} {
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
	} as LooseActor & { type: "explorer" };
}

/** Fixture WITHOUT a known actor type: falls through to the generic builder. */
function openActor(overrides: Record<string, unknown> = {}): LooseActor {
	return fakeActor(overrides) as LooseActor;
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
		const view = actorView(
			openActor({
				id: "a2",
				name: "Sparse",
				type: "vehicle",
				system: {},
			}),
		);
		expect(view.items).toEqual([]);
		expect(view.effects).toEqual([]);
		expect(view.appliedEffects).toEqual([]);
		expect(view.characteristics).toEqual({});
	});
});

describe("actorView per-family system views (bead l2wz)", () => {
	test("a character view is CharacterSystemView — no ship/vehicle fields", () => {
		// The accepted shape, per the bead: actorView(characterActor).system is
		// typed CharacterSystemView, so ship/vehicle reads no longer lie.
		const view = actorView({
			id: "a1",
			uuid: "Actor.a1",
			name: "Sable",
			type: "explorer",
			system: {
				characteristics: { ws: { value: 40, unnatural: 1 } },
				psyker: true,
				wounds: { value: 5, max: 14 },
			},
			items: [],
			effects: [],
			appliedEffects: [],
		});
		expect(view.system.psyker).toBe(true);
		// Type-level pin (the bead's acceptance): system is the character family.
		const system: CharacterSystemView = view.system;
		expect(system.wounds?.max).toBe(14);
		const ship =
			// @ts-expect-error ship fields do not type-check on a character view
			view.system.voidShields;
		expect(ship).toBeUndefined();
		const vehicle =
			// @ts-expect-error vehicle fields do not type-check on a character view
			view.system.size;
		expect(vehicle).toBeUndefined();
	});

	test("a starship view is ShipSystemView — no character fields", () => {
		const view = actorView({
			id: "s1",
			type: "starship",
			system: {
				characteristics: {},
				hullIntegrity: { value: 30, max: 30 },
				voidShields: 2,
			},
		});
		expect(view.system.hullIntegrity?.max).toBe(30);
		expect(view.system.voidShields).toBe(2);
		const leak =
			// @ts-expect-error character fields do not type-check on a ship view
			view.system.psyker;
		expect(leak).toBeUndefined();
	});

	test("a vehicle view is VehicleSystemView — no ship fields", () => {
		const view = actorView({
			id: "v1",
			type: "vehicle",
			system: { characteristics: {}, size: "colossal" },
		});
		expect(view.system.size).toBe("colossal");
		const leak =
			// @ts-expect-error ship fields do not type-check on a vehicle view
			view.system.hullIntegrity;
		expect(leak).toBeUndefined();
	});

	test("unmapped actor families build a bare base view (no family claims)", () => {
		// The builder narrows per actor.type at runtime; a dynasty/planet/cache
		// actor claims none of the RT family fields. Rules code narrows via
		// isCharacterView, which correctly excludes everyone here.
		const view = actorView(
			openActor({ type: "dynasty", system: { ruler: "Winterscale" } }),
		);
		expect(isCharacterView(view)).toBe(false);
		expect("psyker" in view.system).toBe(false);
		expect("voidShields" in view.system).toBe(false);
		expect("size" in view.system).toBe(false);
	});
});

describe("explicit generic instantiation still works (h2uo)", () => {
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

// Bead pwn0: the flag namespace is profile DATA resolved above the domain.
describe("buildActorView flag namespace (bead pwn0)", () => {
	const snapOutEffect = {
		id: "fx1",
		name: "Fleeing",
		flags: {
			"sibling-core": { snapOut: true },
			"rogue-trader": { snapOut: true },
		},
	};

	test("a caller-provided namespace is used to read effect flags", () => {
		const view = buildActorView(
			{ effects: [snapOutEffect] },
			{
				flagNamespace: "sibling-core",
			},
		);
		expect(view.effects[0]?.snapOut).toBe(true);
	});

	test("no namespace means namespaced flags are not read", () => {
		const view = buildActorView({ effects: [snapOutEffect] });
		expect(view.effects[0]?.snapOut).toBe(false);
	});

	test("an explicit direct snapOut field is read regardless", () => {
		const view = buildActorView({
			effects: [{ id: "fx2", name: "Stunned", snapOut: true }],
		});
		expect(view.effects[0]?.snapOut).toBe(true);
	});
});
