/**
 * PC inventory grouping tests (bead packs-pu9): the inventory tab's groups are
 * a pure function (the npc-inventory.ts precedent). The bug: the inventory
 * carried only the four typed groups, so a dropped `special-ability` item —
 * the Table 1-2 heirloom abilities (Core Rulebook p31) — was cloned onto the
 * actor and then rendered nowhere ("can't add heirloom items").
 */
import { describe, expect, it } from "bun:test";
import {
	INVENTORY_EXCLUDED_TYPES,
	pcInventoryGroups,
	PC_EQUIPPABLE_TYPES,
	type PcInventoryItemLike,
} from "./pc-inventory";

const row = (over: Partial<PcInventoryItemLike>): PcInventoryItemLike => ({
	id: "i1",
	name: "Ancestral Seal",
	uuid: "Item.i1",
	type: "special-ability",
	weight: 0,
	quantity: 0,
	equipState: "stowed",
	equipStateLabel: "stowed",
	equipped: false,
	isWeapon: false,
	...over,
});

const names = (groups: ReturnType<typeof pcInventoryGroups>) =>
	groups.map((group) => group.labelKey);

describe("pcInventoryGroups (bead packs-pu9)", () => {
	it("every Table 1-2 heirloom shape lands in a rendered group", () => {
		const groups = pcInventoryGroups([
			row({ name: "Archeotech Laspistol", type: "ranged-weapon", weight: 1.5 }),
			row({
				name: "Saint-blessed Carapace Armour",
				type: "armour",
				weight: 14,
				equipState: "worn",
				equipStateLabel: "worn",
				equipped: true,
			}),
			row({ name: "Ancestral Seal", type: "special-ability" }),
			row({
				name: "Reliquary of Saint Drusus",
				type: "special-ability",
				id: "i2",
			}),
			row({ name: "Frag Missile", type: "ammunition", quantity: 3 }),
		]);
		expect(names(groups)).toEqual([
			"WEAPON.HEADER",
			"ARMOUR.HEADER",
			"AMMUNITION.HEADER",
			"INVENTORY.ABILITIES",
		]);
		// The two special-ability heirlooms are the abilities group's rows.
		expect(groups[3].items.map((item) => item.name)).toEqual([
			"Ancestral Seal",
			"Reliquary of Saint Drusus",
		]);
	});

	it("a special-ability row is NOT equippable and shows no weight slot", () => {
		const groups = pcInventoryGroups([
			row({ name: "Ancestral Seal", type: "special-ability" }),
		]);
		const seal = groups[0].items[0];
		expect(seal.equippable).toBe(false);
		expect(seal.weightLabel).toBe("");
		expect(seal.isWeapon).toBe(false);
	});

	it("ammunition rows carry the xN quantity label and the template flag", () => {
		const groups = pcInventoryGroups([
			row({ name: "Frag Missile", type: "ammunition", quantity: 3 }),
		]);
		const ammo = groups[0].items[0];
		expect(ammo.isAmmunition).toBe(true);
		expect(ammo.weightLabel).toBe("×3");
		expect(ammo.equippable).toBe(false);
	});

	it("unknown types reach the loud catch-all group, never vanish", () => {
		const groups = pcInventoryGroups([
			row({ name: "Mono Upgrade", type: "weapon-modification" }),
			row({ name: "Stummer", type: "tool", weight: 0.5 }),
		]);
		expect(names(groups)).toEqual(["INVENTORY.OTHER"]);
		expect(groups[0].items.map((item) => item.name)).toEqual([
			"Mono Upgrade",
			"Stummer",
		]);
		// The tool carries its weight; the dataless modification hides the slot.
		expect(groups[0].items[0].weightLabel).toBe("");
		expect(groups[0].items[1].weightLabel).toBe("0.5 kg");
	});

	it("empty groups are dropped (including the catch-all with nothing)", () => {
		expect(pcInventoryGroups([])).toEqual([]);
		expect(names(pcInventoryGroups([row({ type: "gear", weight: 2 })])))
			.toEqual(["GEAR.HEADER"]);
	});

	it("excluded types are documented: the tab-owning types stay off the inventory", () => {
		for (const type of ["skill", "talent", "psychicpower", "navigatorpower", "action"]) {
			expect(INVENTORY_EXCLUDED_TYPES.has(type)).toBe(true);
		}
		for (const type of ["melee-weapon", "ranged-weapon", "armour", "gear"]) {
			expect(PC_EQUIPPABLE_TYPES.has(type)).toBe(true);
		}
	});
});