import { describe, expect, it } from "bun:test";
import {
	equipStateOf,
	isReady,
	isWeaponType,
	WEAPON_ITEM_TYPES,
} from "./accessors";

describe("isWeaponType (bead p5nw)", () => {
	it("accepts both weapon item types", () => {
		expect(isWeaponType("melee-weapon")).toBe(true);
		expect(isWeaponType("ranged-weapon")).toBe(true);
		expect(WEAPON_ITEM_TYPES).toEqual(["melee-weapon", "ranged-weapon"]);
	});

	it("rejects everything else", () => {
		expect(isWeaponType("armour")).toBe(false);
		expect(isWeaponType("gear")).toBe(false);
		expect(isWeaponType(undefined)).toBe(false);
		expect(isWeaponType("")).toBe(false);
	});
});

describe("equipStateOf (bead p5nw)", () => {
	it("defaults to stowed per the gear schema initial", () => {
		expect(equipStateOf({ system: {} })).toBe("stowed");
		expect(equipStateOf({})).toBe("stowed");
		expect(equipStateOf({ system: undefined })).toBe("stowed");
	});

	it("reads the equipped state", () => {
		expect(equipStateOf({ system: { equipState: "carried" } })).toBe("carried");
		expect(equipStateOf({ system: { equipState: "worn" } })).toBe("worn");
	});
});

describe("isReady (bead p5nw)", () => {
	it("weapons/gear are ready when carried", () => {
		expect(
			isReady({ type: "ranged-weapon", system: { equipState: "carried" } }),
		).toBe(true);
		expect(
			isReady({ type: "melee-weapon", system: { equipState: "stowed" } }),
		).toBe(false);
	});

	it("armour is ready when worn", () => {
		expect(isReady({ type: "armour", system: { equipState: "worn" } })).toBe(
			true,
		);
		expect(isReady({ type: "armour", system: { equipState: "carried" } })).toBe(
			false,
		);
	});

	it("matches the carriedWeight filter semantics", () => {
		// encumbrance.ts: armour worn OR non-armour carried.
		const item = { type: "gear", system: { equipState: "carried" } };
		expect(isReady(item)).toBe(true);
		expect(
			isReady({ type: "armour", system: { equipState: "stowed" } }),
		).toBe(false);
	});
});