import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const sheet = readFileSync(
	"src/roguetrader/sheet/actor/character-sheet.ts",
	"utf8",
);

describe("character inventory ammunition group (bead 8uc7)", () => {
	test("the inventory context collects owned ammunition", () => {
		expect(sheet).toContain('byType(["ammunition"])');
		expect(sheet).toContain('label: "AMMUNITION.HEADER"');
	});

	test("ammunition rows pass the isAmmunition marker to the template", () => {
		expect(sheet).toContain("isAmmunition: true");
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
		expect(branch).toContain('weight=(concat "×" item.quantity)');
	});

	test("ammunition rows carry NO equip toggle (not equippable)", () => {
		expect(branch).not.toContain("equipToggle");
	});

	test("ammunition rows keep the shared open + delete affordances", () => {
		expect(branch).toContain("(localize \"GEAR.OPEN_SHEET\")");
		expect(branch).toContain('deleteAction="deleteItem"');
	});
});