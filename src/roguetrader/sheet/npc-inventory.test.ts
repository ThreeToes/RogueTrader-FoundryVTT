/**
 * NPC inventory domain tests (bead 2dvj): the grouping and equip-toggle
 * semantics are pure functions so the GM-facing sheet stays thin.
 */
import { describe, expect, it } from "bun:test";
import {
	compendiumSourceOf,
	equipToggleState,
	npcInventoryGroups,
} from "./npc-inventory";

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

	it("non-equippable types keep their state (no toggle is rendered)", () => {
		expect(equipToggleState("talent", "stowed")).toBe("carried");
	});
});

describe("npcInventoryGroups (no more all-types-in-one list)", () => {
	it("groups by type in the documented order with localized label keys", () => {
		const groups = npcInventoryGroups([
			{ id: "t1", name: "Rapid Reload", type: "talent" },
			{ id: "w1", name: "Lasgun", type: "ranged-weapon" },
			{ id: "w2", name: "Chainsword", type: "melee-weapon" },
			{ id: "g1", name: "Rope", type: "gear" },
		]);
		expect(groups.map((g) => g.labelKey)).toEqual([
			"TYPES.Item.ranged-weapon",
			"TYPES.Item.melee-weapon",
			"TYPES.Item.talent",
			"TYPES.Item.gear",
		]);
		expect(groups[0].items.map((i) => i.name)).toEqual(["Lasgun"]);
	});

	it("marks weapons/gear equippable with ready = carried", () => {
		const groups = npcInventoryGroups([
			{ id: "w1", name: "Lasgun", type: "ranged-weapon", system: { equipState: "carried" } },
			{ id: "w2", name: "Sword", type: "melee-weapon", system: { equipState: "stowed" } },
			{ id: "g1", name: "Rope", type: "gear", system: { equipState: "carried" } },
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
		const groups = npcInventoryGroups([{ id: "g1", name: "Rope", type: "gear" }]);
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
						compendiumSource: "Compendium.rogue-trader.weapons.abc123",
					},
				},
			},
			{ id: "w2", name: "Homebrew Gun", type: "ranged-weapon" },
		]);
		const items = groups.flatMap((g) => g.items);
		expect(items.find((i) => i.name === "Lasgun")?.source).toBe(
			"Compendium.rogue-trader.weapons.abc123",
		);
		// standalone/homebrew items render NO link — source stays empty
		expect(items.find((i) => i.name === "Homebrew Gun")?.source).toBe("");
	});
});