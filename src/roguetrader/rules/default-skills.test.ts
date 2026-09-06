import { describe, expect, test } from "bun:test";
import { defaultSkillItems, missingSkillGrants } from "./default-skills";

const catalog = [
	{
		type: "skill",
		name: "Dodge",
		system: { common: false, characteristic: "ag", ladder: 1 },
	},
	{
		type: "skill",
		name: "Speak Language (Low Gothic)",
		system: { common: true, characteristic: "int", ladder: 1 },
	},
	{
		type: "skill",
		name: "Forbidden Lore",
		system: { common: false, characteristic: "int", ladder: 1 },
	},
];

describe("defaultSkillItems", () => {
	test("grants only catalog skills flagged common", () => {
		const items = defaultSkillItems(catalog);
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("Speak Language (Low Gothic)");
		expect(items[0].type).toBe("skill");
	});

	test("grants are owned-at-known clones without ids", () => {
		const items = defaultSkillItems(catalog);
		expect(items[0].system).toEqual({ characteristic: "int", ladder: 1 });
		expect(items[0]).not.toHaveProperty("_id");
	});

	test("empty catalog grants nothing", () => {
		expect(defaultSkillItems([])).toEqual([]);
	});
});

describe("missingSkillGrants (race-safe default grants)", () => {
	test("filters out skills the actor already owns (exact name)", () => {
		const grants = missingSkillGrants(catalog, [
			"Speak Language (Low Gothic)",
		]);
		expect(grants).toHaveLength(0);
	});

	test("case- and whitespace-insensitive matching", () => {
		const grants = missingSkillGrants(catalog, [
			"  speak language (low gothic)",
		]);
		expect(grants).toHaveLength(0);
	});

	test("keeps unowned common skills", () => {
		const grants = missingSkillGrants(catalog, ["Climb", "Swim"]);
		expect(grants).toHaveLength(1);
		expect(grants[0].name).toBe("Speak Language (Low Gothic)");
	});

	test("no existing items grants everything common", () => {
		expect(missingSkillGrants(catalog, [])).toEqual(defaultSkillItems(catalog));
	});
});
