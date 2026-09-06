import { describe, expect, test } from "bun:test";
import { npcEquipDefault } from "./drop-clone";

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