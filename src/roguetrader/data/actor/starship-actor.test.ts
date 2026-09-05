import { describe, expect, it } from "bun:test";
import { crewQualityEffects } from "./starship-actor";

describe("crew quality (rt_core p193)", () => {
	it("maps SP deltas and skill levels", () => {
		expect(crewQualityEffects("incompetent")).toEqual({ skill: 20, spDelta: 5 });
		expect(crewQualityEffects("competent")).toEqual({ skill: 30, spDelta: 0 });
		expect(crewQualityEffects("crack")).toEqual({ skill: 40, spDelta: -5 });
		expect(crewQualityEffects("veteran")).toEqual({ skill: 50, spDelta: -15 });
	});

	it("falls back to competent for unknown values", () => {
		expect(crewQualityEffects("bogus")).toEqual({ skill: 30, spDelta: 0 });
	});
});