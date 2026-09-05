import { describe, expect, test } from "bun:test";
import { Availability, normalizeAvailability } from "./availability";

describe("normalizeAvailability (world-load brick fix)", () => {
	test("valid enum values pass through", () => {
		for (const value of Object.values(Availability)) {
			expect(normalizeAvailability(value)).toBe(value);
		}
	});

	test("capitalized legacy values normalize to lowercase", () => {
		expect(normalizeAvailability("Common")).toBe("common");
		expect(normalizeAvailability("Very Rare")).toBe("very-rare");
		expect(normalizeAvailability("NEAR UNIQUE")).toBe("near-unique");
	});

	test("whitespace and padding are trimmed", () => {
		expect(normalizeAvailability("  rare  ")).toBe("rare");
	});

	test("placeholder dashes fall back to common without warning-worthy noise", () => {
		expect(normalizeAvailability("—")).toBe("common");
		expect(normalizeAvailability("-")).toBe("common");
		expect(normalizeAvailability("")).toBe("common");
		expect(normalizeAvailability(undefined)).toBe("common");
	});

	test("unknown values fall back to common (warns on console)", () => {
		expect(normalizeAvailability("banana")).toBe("common");
	});
});