import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pcInventoryGroups } from "../pc-inventory";

// Static guard for the ammunition inventory group (bead 8uc7): owned
// ordnance must stay visible + draggable on the character inventory. The
// gap was that byType listed only weapons/armour/gear, so owned missiles
// rendered nowhere and could not be dragged onto a launcher. Pin the
// template's ammunition row branch and the sheet's group so the gap
// cannot silently return (background-afflictions.test.ts pattern).
const template = readFileSync(
	"template/sheet/actor/tabs/inventory.hbs",
	"utf8",
);

describe("character inventory ammunition group (bead 8uc7)", () => {
	test("the grouping module types the ammunition group (bead packs-pu9)", () => {
		// The grouping moved into the pure pc-inventory module (packs-pu9); the
		// ammunition group with its template marker lives there now.
		const groups = pcInventoryGroups([
			{
				id: "a1",
				name: "Frag Missile",
				uuid: "Item.a1",
				type: "ammunition",
				weight: 0,
				quantity: 2,
				equipState: "stowed",
				equipStateLabel: "stowed",
				equipped: false,
				isWeapon: false,
			},
		]);
		expect(groups.map((group) => group.labelKey)).toEqual([
			"AMMUNITION.HEADER",
		]);
	});

	test("ammunition rows pass the isAmmunition marker to the template", () => {
		const groups = pcInventoryGroups([
			{
				id: "a1",
				name: "Frag Missile",
				uuid: "Item.a1",
				type: "ammunition",
				weight: 0,
				quantity: 2,
				equipState: "stowed",
				equipStateLabel: "stowed",
				equipped: false,
				isWeapon: false,
			},
		]);
		expect(groups[0].items[0].isAmmunition).toBe(true);
		// Marker is on the row, never on the typed groups.
		const notAmmo = pcInventoryGroups([
			{
				id: "g1",
				name: "Rope",
				uuid: "Item.g1",
				type: "gear",
				weight: 2,
				quantity: 0,
				equipState: "stowed",
				equipStateLabel: "stowed",
				equipped: false,
				isWeapon: false,
			},
		]);
		expect(notAmmo[0].items[0].isAmmunition).toBeUndefined();
	});

	// Slice out the ammunition row branch so the assertions only cover it,
	// not the gear branch's identical anchors.
	const start = template.indexOf("{{else if item.isAmmunition}}");
	const end = template.indexOf("{{else}}", start);
	const branch = template.slice(start, end);

	test("the template has an ammunition row branch", () => {
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
	});

	test("ammunition rows are draggable inventory rows", () => {
		expect(branch).toContain("rt/inv-row");
		expect(branch).toContain("draggable=true");
		expect(branch).toContain("gripVertical=true");
		expect(branch).toContain("uuid=item.uuid");
	});

	test("ammunition rows show the xN quantity in the weight slot", () => {
		// The ×N label is now computed on the row (weightLabel) by the pure
		// grouping; the template just passes it through (bead packs-pu9).
		expect(branch).toContain("weight=item.weightLabel");
	});

	test("ammunition rows carry NO equip toggle (not equippable)", () => {
		expect(branch).not.toContain("equipToggle");
	});

	test("ammunition rows keep the shared open + delete affordances", () => {
		expect(branch).toContain('(localize "GEAR.OPEN_SHEET")');
		expect(branch).toContain('deleteAction="deleteItem"');
	});
});
