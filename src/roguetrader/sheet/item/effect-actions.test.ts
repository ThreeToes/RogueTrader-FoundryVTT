import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

	// Owner report: effect kinds were missing translations — kinds registered by
	// talent-effects (tearing, toxic …) had no label key and degraded to the raw
	// slug in the dropdown. Guard: every offered kind resolves to a label key
	// that exists in ALL FOUR language files.
	test("every registered kind label exists in all four languages", () => {
		for (const value of Object.values(kindChoices)) {
			expect(String(value), String(value)).toMatch(/^EFFECT_KIND\./);
			for (const lang of ["en", "es", "fr", "pl"]) {
				const keys = JSON.parse(
					readFileSync(`lang/${lang}.json`, "utf8"),
				) as Record<string, string>;
				expect(keys[String(value)], `${String(value)} in ${lang}`).toBeDefined();
			}
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