import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The Background tab renders mutations/madness afflictions only as chips
// (bead rdh1), with no delete affordance anywhere else on the sheet — bead
// fjtr added the same inv-delete anchor the talent rows use. Pin the template
// so a refactor cannot silently drop it again.
const template = readFileSync(
	"template/sheet/actor/tabs/background.hbs",
	"utf8",
);

describe("background tab affliction delete affordance (bead fjtr)", () => {
	// Slice out the afflictions each-block so the assertions only cover the
	// chips, not the talent rows' identical anchors further down the file.
	// The block starts at the each and ends before the affliction grants
	// comment that closes the section.
	const start = template.indexOf("{{#each madness.afflictionGroups as |group|}}");
	const end = template.indexOf("{{!-- Trait/talent grants from owned afflictions");
	const afflictions = template.slice(start, end);

	test("the each block exists in the template", () => {
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
	});

	test("the affliction chips carry a deleteItem anchor", () => {
		expect(afflictions).toContain('class="inv-delete"');
		expect(afflictions).toContain('data-action="deleteItem"');
		expect(afflictions).toContain('data-item-id="{{a.id}}"');
	});

	test("the delete tooltip is the shared GEAR.DELETE key", () => {
		expect(afflictions).toContain('data-tooltip="{{localize "GEAR.DELETE"}}"');
	});

	test("the attack-mutation roll chip is kept alongside the delete anchor", () => {
		expect(afflictions).toContain('data-action="rollWeapon"');
	});
});