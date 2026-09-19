/**
 * Vehicle token footprint mapping (bead yyd1).
 *
 * The acceptance is explicit: a Hulking scout bike and a Massive lander must
 * produce different footprints. These tests pin the whole Core Rulebook size
 * ladder plus the free-text fallbacks the data model allows.
 */
import { describe, expect, it } from "bun:test";
import {
	DEFAULT_TOKEN_FOOTPRINT,
	SIZE_MODIFIERS,
	tokenFootprintLabel,
	vehicleTokenFootprint,
} from "./vehicle-tokens";

describe("vehicle token footprints (bead yyd1)", () => {
	it("maps every size category to one square per +10 modifier", () => {
		expect(vehicleTokenFootprint("Miniscule")).toEqual({ width: 1, height: 1 });
		expect(vehicleTokenFootprint("Puny")).toEqual({ width: 1, height: 1 });
		expect(vehicleTokenFootprint("Scrawny")).toEqual({ width: 1, height: 1 });
		expect(vehicleTokenFootprint("Average")).toEqual({ width: 1, height: 1 });
		expect(vehicleTokenFootprint("Hulking")).toEqual({ width: 2, height: 2 });
		expect(vehicleTokenFootprint("Enormous")).toEqual({ width: 3, height: 3 });
		expect(vehicleTokenFootprint("Massive")).toEqual({ width: 4, height: 4 });
		expect(vehicleTokenFootprint("Immense")).toEqual({ width: 5, height: 5 });
		expect(vehicleTokenFootprint("Monumental")).toEqual({ width: 6, height: 6 });
		expect(vehicleTokenFootprint("Titanic")).toEqual({ width: 7, height: 7 });
	});

	it("every category above Average is one square per +10", () => {
		for (const [size, modifier] of Object.entries(SIZE_MODIFIERS)) {
			const { width, height } = vehicleTokenFootprint(size);
			expect(width, size).toBe(Math.max(1, 1 + Math.floor(modifier / 10)));
			expect(width, size).toBe(height);
		}
	});

	it("accepts the free-text the data model allows (case/whitespace)", () => {
		expect(vehicleTokenFootprint(" hulking ")).toEqual({ width: 2, height: 2 });
		expect(vehicleTokenFootprint("MASSIVE")).toEqual({ width: 4, height: 4 });
	});

	it("falls back to an average footprint for blank/unknown sizes", () => {
		for (const size of ["", "   ", "Colossal", undefined, null]) {
			expect(vehicleTokenFootprint(size)).toEqual({
				width: DEFAULT_TOKEN_FOOTPRINT,
				height: DEFAULT_TOKEN_FOOTPRINT,
			});
		}
	});

	it("labels the footprint for the sheet in grid squares", () => {
		expect(tokenFootprintLabel("Enormous")).toBe("3 x 3");
		expect(tokenFootprintLabel("")).toBe("1 x 1");
	});

	it("distinguishes a Hulking scout bike from a Massive lander (acceptance)", () => {
		expect(vehicleTokenFootprint("Hulking")).not.toEqual(
			vehicleTokenFootprint("Massive"),
		);
	});
});
