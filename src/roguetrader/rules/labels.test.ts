import { describe, expect, test } from "bun:test";
import { bodyLocationLabelKey, locationKeySuffix } from "./labels";

describe("locationKeySuffix", () => {
	test("single-word locations pass through uppercased", () => {
		expect(locationKeySuffix("head")).toBe("HEAD");
		expect(locationKeySuffix("body")).toBe("BODY");
	});

	test("hyphenated locations become upper snake case", () => {
		expect(locationKeySuffix("left-arm")).toBe("LEFT_ARM");
		expect(locationKeySuffix("right-leg")).toBe("RIGHT_LEG");
	});
});

describe("bodyLocationLabelKey (bead e0x follow-up)", () => {
	test("every hit-location value maps to a defined lang key", () => {
		const locations = [
			"head",
			"body",
			"left-arm",
			"right-arm",
			"left-leg",
			"right-leg",
		];
		expect(locations.map(bodyLocationLabelKey)).toEqual([
			"BODY_LOCATION.HEAD",
			"BODY_LOCATION.BODY",
			"BODY_LOCATION.LEFT_ARM",
			"BODY_LOCATION.RIGHT_ARM",
			"BODY_LOCATION.LEFT_LEG",
			"BODY_LOCATION.RIGHT_LEG",
		]);
	});
});
