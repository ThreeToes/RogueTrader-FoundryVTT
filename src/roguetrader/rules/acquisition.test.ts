import { describe, expect, it } from "bun:test";
import {
	acquisitionTarget,
	availabilityModifier,
	resolveAcquisition,
	startingProfitFactorAndShipPoints,
} from "./acquisition";

describe("Table 1-5 starting PF/SP (p33)", () => {
	it("maps the 1d10 ladder", () => {
		expect(startingProfitFactorAndShipPoints(1)).toEqual({ profitFactor: 60, shipPoints: 30 });
		expect(startingProfitFactorAndShipPoints(2)).toEqual({ profitFactor: 50, shipPoints: 40 });
		expect(startingProfitFactorAndShipPoints(3)).toEqual({ profitFactor: 50, shipPoints: 40 });
		expect(startingProfitFactorAndShipPoints(4)).toEqual({ profitFactor: 40, shipPoints: 50 });
		expect(startingProfitFactorAndShipPoints(7)).toEqual({ profitFactor: 40, shipPoints: 50 });
		expect(startingProfitFactorAndShipPoints(8)).toEqual({ profitFactor: 30, shipPoints: 60 });
		expect(startingProfitFactorAndShipPoints(9)).toEqual({ profitFactor: 30, shipPoints: 60 });
		expect(startingProfitFactorAndShipPoints(10)).toEqual({ profitFactor: 20, shipPoints: 70 });
	});
});

describe("acquisition target (rt_core p272-273)", () => {
	it("sums modifiers into the target", () => {
		const result = acquisitionTarget({
			profitFactor: 40,
			availabilityModifier: 30,
			scaleModifier: 30,
		});
		expect(result.target).toBe(100);
		expect(result.automatic).toBe("success");
	});

	it("auto-fails at 0 or less", () => {
		expect(
			acquisitionTarget({ profitFactor: 30, availabilityModifier: -30 }).automatic,
		).toBe("failure");
	});

	it("resolves rolls inside the band", () => {
		expect(resolveAcquisition({ profitFactor: 40 }, 41).success).toBe(false);
		expect(resolveAcquisition({ profitFactor: 40 }, 40).success).toBe(true);
		expect(resolveAcquisition({ profitFactor: 60, extra: 40 }, 1).success).toBe(true);
		expect(resolveAcquisition({ profitFactor: 20 }, 100).success).toBe(false);
	});
});

describe("availability modifiers (Table 9-35)", () => {
	it("maps the pack availability strings", () => {
		expect(availabilityModifier("plentiful")).toBe(30);
		expect(availabilityModifier("scarce")).toBe(0);
		expect(availabilityModifier("very-rare")).toBe(-20);
		expect(availabilityModifier("near-unique")).toBe(-50);
	});

	it("returns null for unknown strings", () => {
		expect(availabilityModifier("made-up")).toBeNull();
	});
});