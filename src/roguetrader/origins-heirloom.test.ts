import { describe, expect, test } from "bun:test";
import { heirloomForRoll, heirloomItems } from "./origins";

// Bead rboc: Table 1-2: Heirloom Items (Core Rulebook p31, layout pp30-31).
// Five 1d100 ranges rolled by the creator's stage 3.5.

describe("heirloom table (Core Rulebook Table 1-2)", () => {
	test("five entries cover 1-100 exactly, in order", () => {
		expect(heirloomItems).toHaveLength(5);
		let next = 1;
		for (const entry of heirloomItems) {
			expect(entry.range[0]).toBe(next);
			expect(entry.range[1]).toBeGreaterThanOrEqual(entry.range[0]);
			next = entry.range[1] + 1;
		}
		expect(next).toBe(101);
	});

	test("book range boundaries resolve to the right entry", () => {
		expect(heirloomForRoll(1).name).toBe("Archeotech Laspistol");
		expect(heirloomForRoll(20).name).toBe("Archeotech Laspistol");
		expect(heirloomForRoll(21).name).toBe("Angevin Era Chainsword");
		expect(heirloomForRoll(40).name).toBe("Angevin Era Chainsword");
		expect(heirloomForRoll(41).name).toBe("Ancestral Seal");
		expect(heirloomForRoll(60).name).toBe("Ancestral Seal");
		expect(heirloomForRoll(61).name).toBe("Saint-blessed Carapace Armour");
		expect(heirloomForRoll(80).name).toBe("Saint-blessed Carapace Armour");
		expect(heirloomForRoll(81).name).toBe("Reliquary of Saint Drusus");
		expect(heirloomForRoll(100).name).toBe("Reliquary of Saint Drusus");
	});

	test("rolls outside 1-100 fail loudly", () => {
		expect(() => heirloomForRoll(0)).toThrow();
		expect(() => heirloomForRoll(101)).toThrow();
	});

	test("item rows grant pack-item clones with best craftsmanship", () => {
		const pistol = heirloomForRoll(5);
		expect(pistol.grant).toEqual({
			kind: "pack-item",
			pack: "rogue-trader.weapons",
			item: "Archeotech Laspistol",
			craftsmanship: "best",
		});
		const armour = heirloomForRoll(70);
		expect(armour.grant).toMatchObject({ kind: "pack-item", craftsmanship: "best" });
	});

	test("conditional-bonus rows grant note items", () => {
		expect(heirloomForRoll(50).grant.kind).toBe("note-item");
		expect(heirloomForRoll(90).grant.kind).toBe("note-item");
	});
});