import { describe, expect, test } from "bun:test";
import { defaultSkillItems } from "./default-skills";

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
