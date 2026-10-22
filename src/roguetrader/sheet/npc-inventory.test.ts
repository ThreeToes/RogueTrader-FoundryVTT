/**
 * NPC inventory domain tests (bead 2dvj): the grouping and equip-toggle
 * semantics are pure functions so the GM-facing sheet stays thin.
 */
import { describe, expect, it } from "bun:test";
import { isReady } from "../data/accessors";
import {
	compendiumSourceOf,
	equipToggleState,
	NPC_EQUIPPABLE_TYPES,
	npcInventoryGroups,
} from "./npc-inventory";
import { PC_EQUIPPABLE_TYPES } from "./pc-inventory";

describe("PC/NPC equippable-type parity (bead q8il, open bead o4w2)", () => {
	it("NPC_EQUIPPABLE_TYPES is a subset of the single-source PC set", () => {
		// The PC set (sheet/pc-inventory.ts) is the one source of truth; the
		// sheet-level allowlist duplication (with its phantom "weapon" type)
		// is gone. The NPC sheet's toggle set must never drift outside it.
		for (const type of NPC_EQUIPPABLE_TYPES) {
			expect(PC_EQUIPPABLE_TYPES.has(type)).toBe(true);
		}
	});

	it("the only deliberate difference is armour (NPC armour panel owns wear/stow)", () => {
		const pcOnly = [...PC_EQUIPPABLE_TYPES].filter(
			(type) => !NPC_EQUIPPABLE_TYPES.has(type),
		);
		expect(pcOnly).toEqual(["armour"]);
	});
});

describe("equipToggleState (armour-aware, bead 2dvj)", () => {
	it("armour cycles worn <-> stowed (never 'carried')", () => {
		expect(equipToggleState("armour", "worn")).toBe("stowed");
		expect(equipToggleState("armour", "stowed")).toBe("worn");
	});

	it("weapons and gear cycle stowed <-> carried", () => {
		expect(equipToggleState("ranged-weapon", "stowed")).toBe("carried");
		expect(equipToggleState("ranged-weapon", "carried")).toBe("stowed");
		expect(equipToggleState("melee-weapon", "carried")).toBe("stowed");
		expect(equipToggleState("gear", "stowed")).toBe("carried");
	});

	it("non-equippables never render a toggle anchor; the function itself cycles stowed/carried", () => {
		expect(equipToggleState("talent", "stowed")).toBe("carried");
	});
});

describe("npcInventoryGroups (no more all-types-in-one list)", () => {
	// Bead tkm7: the row builder's `ready` moved from an inline
	// "equipState === carried" copy to the shared isReady predicate. Armour is
	// excluded upstream (EXCLUDED_TYPES), so for every type that REACHES the
	// builder the two agree exactly — pinned here so the latent divergence
	// (armour allowed into a group later) fails loudly instead of silently.
	it("every emitted row's ready flag matches the shared isReady predicate", () => {
		let n = 0;
		const items = [
			"ranged-weapon",
			"melee-weapon",
			"gear",
			"talent",
			"ammunition",
		].flatMap((type) =>
			["stowed", "carried", "worn", undefined].map((equipState) => ({
				id: `i${n++}`,
				name: "row",
				type,
				system: { equipState },
			})),
		);
		const byId = new Map(items.map((i) => [i.id, i]));
		const rows = npcInventoryGroups(items).flatMap((g) => g.items);
		for (const row of rows) {
			expect(row.ready).toBe(isReady(byId.get(row.id) as never));
		}
	});


	it("groups by type in the documented order with localized label keys", () => {
		const groups = npcInventoryGroups([
			{ id: "t1", name: "Rapid Reload", type: "talent" },
			{ id: "w1", name: "Lasgun", type: "ranged-weapon" },
			{ id: "w2", name: "Chainsword", type: "melee-weapon" },
			{ id: "g1", name: "Rope", type: "gear" },
			{ id: "a1", name: "Frag Missile", type: "ammunition" },
		]);
		expect(groups.map((g) => g.labelKey)).toEqual([
			"TYPES.Item.ranged-weapon",
			"TYPES.Item.melee-weapon",
			"TYPES.Item.talent",
			"TYPES.Item.gear",
			// Ammunition gets its OWN group (bead 8uc7): with no group it
			// fell into OTHER and could not be dragged onto a launcher.
			"TYPES.Item.ammunition",
		]);
		expect(groups[0].items.map((i) => i.name)).toEqual(["Lasgun"]);
	});

	it("ammunition is grouped but NOT equippable (no stow/carry toggle, bead 8uc7)", () => {
		const groups = npcInventoryGroups([
			{ id: "a1", name: "Frag Missile", type: "ammunition" },
		]);
		expect(groups.map((g) => g.labelKey)).toEqual(["TYPES.Item.ammunition"]);
		expect(groups[0].items[0]).toMatchObject({
			id: "a1",
			name: "Frag Missile",
			type: "ammunition",
			equippable: false,
			ready: false,
		});
	});

	it("marks weapons/gear equippable with ready = carried", () => {
		const groups = npcInventoryGroups([
			{
				id: "w1",
				name: "Lasgun",
				type: "ranged-weapon",
				system: { equipState: "carried" },
			},
			{
				id: "w2",
				name: "Sword",
				type: "melee-weapon",
				system: { equipState: "stowed" },
			},
			{
				id: "g1",
				name: "Rope",
				type: "gear",
				system: { equipState: "carried" },
			},
			{ id: "t1", name: "Rapid Reload", type: "talent" },
		]);
		const byName = new Map(
			groups.flatMap((g) => g.items).map((i) => [i.name, i]),
		);
		expect(byName.get("Lasgun")).toMatchObject({
			equippable: true,
			ready: true,
		});
		expect(byName.get("Sword")).toMatchObject({
			equippable: true,
			ready: false,
		});
		expect(byName.get("Rope")).toMatchObject({
			equippable: true,
			ready: true,
		});
		expect(byName.get("Rapid Reload")).toMatchObject({
			equippable: false,
			ready: false,
		});
	});

	it("armour rows would agree with isReady too (they never reach the builder, bead tkm7)", () => {
		// The latent divergence: if armour were ever allowed into a group, the
		// shared predicate would report it ready when WORN — the old inline copy
		// never would. The pin is the shared predicate itself; this test just
		// documents the armour semantics the equivalence relies on.
		expect(isReady({ type: "armour", system: { equipState: "worn" } })).toBe(
			true,
		);
		expect(isReady({ type: "armour", system: { equipState: "carried" } })).toBe(
			false,
		);
	});

	it("excludes skills, powers and armour (handled elsewhere)", () => {
		const groups = npcInventoryGroups([
			{ id: "s1", name: "Awareness", type: "skill" },
			{ id: "p1", name: "Smite", type: "psychicpower" },
			{ id: "n1", name: "Warp Sight", type: "navigatorpower" },
			{ id: "a1", name: "Flak Armour", type: "armour" },
		]);
		expect(groups).toEqual([]);
	});

	it("catches unlisted types in the loud OTHER group (never dropped)", () => {
		const groups = npcInventoryGroups([
			{ id: "c1", name: "Bionic Eye", type: "cybernetic" },
			{ id: "d1", name: "Stim", type: "drug" },
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].labelKey).toBe("NPC.GROUP_OTHER");
		expect(groups[0].items.map((i) => i.name)).toEqual(["Bionic Eye", "Stim"]);
		expect(groups[0].items.every((i) => !i.equippable)).toBe(true);
	});

	it("drops empty groups", () => {
		const groups = npcInventoryGroups([
			{ id: "g1", name: "Rope", type: "gear" },
		]);
		expect(groups.map((g) => g.labelKey)).toEqual(["TYPES.Item.gear"]);
	});

	it("threads the compendium source stamp (et3x) onto entries (bead kwm9)", () => {
		const groups = npcInventoryGroups([
			{
				id: "w1",
				name: "Lasgun",
				type: "ranged-weapon",
				flags: {
					"rogue-trader": {
						compendiumSource: "Compendium.rogue-trader.equipment.abc123",
					},
				},
			},
			{ id: "w2", name: "Homebrew Gun", type: "ranged-weapon" },
		]);
		const items = groups.flatMap((g) => g.items);
		expect(items.find((i) => i.name === "Lasgun")?.source).toBe(
			"Compendium.rogue-trader.equipment.abc123",
		);
		// standalone/homebrew items render NO link — source stays empty
		expect(items.find((i) => i.name === "Homebrew Gun")?.source).toBe("");
	});
});
