import { describe, expect, test } from "bun:test";
import "../../../test-helpers/foundry-schema-stub";
import { effectEditorChoices } from "./effect-actions";

describe("effect editor choices (localized dropdowns)", () => {
	const { kindChoices, testKeyChoices } = effectEditorChoices(
		(key) => key,
	);

	test("kind dropdown covers registered kinds with label keys", () => {
		expect(kindChoices["test-modifier"]).toBe("EFFECT_KIND.TEST_MODIFIER");
		for (const kind of ["wounds-max", "damage-flat", "critical-damage"]) {
			expect(kindChoices[kind]).toBe(`EFFECT_KIND.${kind.replace(/-/g, "_").toUpperCase()}`);
		}
	});

	test("test-key dropdown starts with the all-tests wildcard", () => {
		expect(testKeyChoices[""]).toBe("EFFECTS.ALL_TESTS");
	});

	test("all characteristics have a label", () => {
		for (const key of ["ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel"]) {
			expect(testKeyChoices[key]).toMatch(/^CHARACTERISTIC\./);
		}
	});
});