/**
 * Owned-skill lookup tests (bead bw9x) — findOwnedSkillItem +
 * untrainedCharacteristicFor, the shared rule the evasion reaction and the
 * action-handler dodge route both read.
 */

import { describe, expect, test } from "bun:test";
import {
	findOwnedSkillItem,
	untrainedCharacteristicFor,
	UNTRAINED_SKILL_CHARACTERISTIC,
	type SkillItemLike,
} from "./skill-lookup";

function actorWith(items: SkillItemLike[]): { items: SkillItemLike[] } {
	return { items };
}

describe("findOwnedSkillItem", () => {
	test("finds the trained skill item by English name", () => {
		const dodge = { id: "i1", name: "Dodge", type: "skill" };
		const actor = actorWith([
			{ id: "i0", name: "Awareness", type: "skill" },
			dodge,
		]);
		expect(findOwnedSkillItem(actor, "Dodge")).toBe(dodge);
	});

	test("returns the item when the name matches Parry among others", () => {
		const parry = { id: "i2", name: "Parry", type: "skill" };
		const actor = actorWith([parry, { id: "i3", name: "Dodge", type: "skill" }]);
		expect(findOwnedSkillItem(actor, "Parry")).toBe(parry);
	});

	test("does not match a non-skill item with the same name", () => {
		const actor = actorWith([
			{ id: "i4", name: "Dodge", type: "talent" },
			{ id: "i5", name: "Parry", type: "talent" },
		]);
		expect(findOwnedSkillItem(actor, "Dodge")).toBeUndefined();
		expect(findOwnedSkillItem(actor, "Parry")).toBeUndefined();
	});

	test("is case-exact: 'dodge' does not match 'Dodge'", () => {
		const actor = actorWith([{ id: "i6", name: "dodge", type: "skill" }]);
		expect(findOwnedSkillItem(actor, "Dodge")).toBeUndefined();
	});

	test("missing items: an empty and an absent-name collection find nothing", () => {
		expect(findOwnedSkillItem(actorWith([]), "Dodge")).toBeUndefined();
		expect(
			findOwnedSkillItem(
				actorWith([{ id: "i7", name: "Medicae", type: "skill" }]),
				"Parry",
			),
		).toBeUndefined();
	});
});

describe("untrainedCharacteristicFor", () => {
	test("Dodge falls back to Agility", () => {
		expect(untrainedCharacteristicFor("Dodge")).toBe("ag");
	});

	test("Parry falls back to Weapon Skill", () => {
		expect(untrainedCharacteristicFor("Parry")).toBe("ws");
	});

	test("the table carries both reaction names and only those", () => {
		expect(Object.keys(UNTRAINED_SKILL_CHARACTERISTIC).sort()).toEqual([
			"Dodge",
			"Parry",
		]);
	});

	test("an unknown name has no fallback (caller decides)", () => {
		expect(untrainedCharacteristicFor("Medicae")).toBeUndefined();
	});
});