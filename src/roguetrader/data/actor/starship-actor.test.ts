import { describe, expect, it } from "bun:test";
import { StarshipActor, crewQualityEffects } from "./starship-actor";

describe("crew quality (Core Rulebook p193)", () => {
	it("maps SP deltas and skill levels", () => {
		expect(crewQualityEffects("incompetent")).toEqual({
			skill: 20,
			spDelta: 5,
		});
		expect(crewQualityEffects("competent")).toEqual({ skill: 30, spDelta: 0 });
		expect(crewQualityEffects("crack")).toEqual({ skill: 40, spDelta: -5 });
		expect(crewQualityEffects("veteran")).toEqual({ skill: 50, spDelta: -15 });
		// Table 8-9 (Core Rulebook p214): Elite is an NPC crew rating, NOT a
		// SP purchase rung — skill 60, no SP delta.
		expect(crewQualityEffects("elite")).toEqual({ skill: 60, spDelta: 0 });
	});

	it("falls back to competent for unknown values", () => {
		expect(crewQualityEffects("bogus")).toEqual({ skill: 30, spDelta: 0 });
	});
});

// Bead om4j: round-2 fields — void shields (Table 8-3 book p201), crew
// population/morale percentage tracks (book p224; p221 Hull Integrity damage
// also wounds Crew/Morale).
describe("starship schema round 2 (bead om4j)", () => {
	const schema = StarshipActor.defineSchema() as unknown as Record<string, any>;

	it("voidShields is a non-negative integer starting at 0", () => {
		const f = schema.voidShields as any;
		expect(f.opts.initial).toBe(0);
		expect(f.opts.min).toBe(0);
		expect(f.opts.integer).toBe(true);
	});

	it("crew population and morale are 0-100 percentage tracks starting full", () => {
		for (const key of ["crewPopulation", "crewMorale"]) {
			const f = schema[key] as any;
			expect(f.opts.initial).toBe(100);
			expect(f.opts.min).toBe(0);
			expect(f.opts.max).toBe(100);
			expect(f.opts.integer).toBe(true);
		}
	});

	// Bead wp6o (round-3 review): SchemaField#getInitialValue on the v14.366
	// runtime resolves an uninitialsed recursive schema through the
	// required-fallback's _cleanType({}) into a truthy
	// {population: null, morale: null} — the kernel's !turnStartCrew seeding
	// branch never fired on a live document. The whole field must declare
	// nullable + initial null so a fresh document really starts at null.
	it("turnStartCrew is whole-field nullable with initial null (no truthy child default object)", () => {
		const f = schema.turnStartCrew as any;
		expect(f.opts.nullable).toBe(true);
		expect(f.opts.initial).toBe(null);
		for (const child of ["population", "morale"]) {
			const c = f.fields[child] as any;
			expect(c.opts.nullable).toBe(true);
			expect(c.opts.initial).toBe(null);
		}
	});
});
