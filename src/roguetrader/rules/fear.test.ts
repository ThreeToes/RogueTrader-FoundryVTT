import { describe, expect, test } from "bun:test";
import { buildActorView } from "../../ffg/domain/model/build";
import {
	degreesOfFailure,
	fearImmune,
	fearReroll,
	fearSeverityModifier,
	fearTestModifier,
	parseFearRating,
	resolveFearRating,
	shockOutcome,
} from "./fear";

describe("fearTestModifier (bead jpbm, Table 10-3 p295)", () => {
	test("Fear (1) = 0, (2) −10, (3) −20, (4) −30", () => {
		expect(fearTestModifier(1)).toBe(0);
		expect(fearTestModifier(2)).toBe(-10);
		expect(fearTestModifier(3)).toBe(-20);
		expect(fearTestModifier(4)).toBe(-30);
	});

	test("invalid ratings fail loudly", () => {
		expect(() => fearTestModifier(0)).toThrow();
		expect(() => fearTestModifier(1.5)).toThrow();
		expect(() => fearTestModifier(Number.NaN)).toThrow();
	});
});

describe("parseFearRating", () => {
	test("name and benefit forms", () => {
		expect(parseFearRating("Fear (2)", "2")).toBe(2);
		expect(parseFearRating("Fear (2)", undefined)).toBe(2);
		expect(parseFearRating("Fear", "4")).toBe(4);
		expect(parseFearRating(undefined, "3")).toBe(3);
	});

	test("unparseable returns null", () => {
		expect(parseFearRating("Fear", undefined)).toBeNull();
		expect(parseFearRating(undefined, undefined)).toBeNull();
	});
});

describe("resolveFearRating (traits are innate, always live)", () => {
	test("picks the strongest Fear (X) trait", () => {
		const actor = {
			items: [
				{ name: "Fearless", type: "talent", system: {} },
				{ name: "Fear (2)", type: "trait", system: { benefit: "2" } },
				{ name: "Fear (3)", type: "trait", system: { benefit: "3" } },
			],
		};
		expect(resolveFearRating(actor)).toBe(3);
	});

	test("no fear traits -> null; non-trait types ignored", () => {
		expect(
			resolveFearRating({
				items: [{ name: "Fear (2)", type: "talent", system: { benefit: "2" } }],
			}),
		).toBeNull();
		expect(resolveFearRating({ items: [] })).toBeNull();
	});

	test("unparseable Fear trait is skipped loudly, not fatal", () => {
		const actor = {
			items: [{ name: "Fear (X)", type: "trait", system: { benefit: "X" } }],
		};
		expect(resolveFearRating(actor)).toBeNull();
	});
});

describe("degreesOfFailure (mirror of the kernel's success rule)", () => {
	test("one degree at exactly one over, one per full 10 beyond", () => {
		expect(degreesOfFailure(50, 51)).toBe(1);
		expect(degreesOfFailure(50, 60)).toBe(2);
		expect(degreesOfFailure(50, 100)).toBe(6);
		expect(degreesOfFailure(50, 50)).toBe(1); // success: still 1 "degree"
	});
});

describe("shockOutcome (Table 10-4 p294)", () => {
	test("bucket boundaries", () => {
		expect(shockOutcome(1).textKey).toBe("FEAR.SHOCK_01_20");
		expect(shockOutcome(20).textKey).toBe("FEAR.SHOCK_01_20");
		expect(shockOutcome(21).textKey).toBe("FEAR.SHOCK_21_40");
		expect(shockOutcome(100).textKey).toBe("FEAR.SHOCK_81_100");
		expect(shockOutcome(101).textKey).toBe("FEAR.SHOCK_101_120");
		expect(shockOutcome(171).textKey).toBe("FEAR.SHOCK_171_PLUS");
	});

	test("open-ended top bucket", () => {
		expect(shockOutcome(999).textKey).toBe("FEAR.SHOCK_171_PLUS");
	});
});

describe("fear immunity / reroll effect kinds (bead jpbm, via registry — bead 4398)", () => {
	// Bead 4398: these read through collectEffects now, so the fixtures are
	// document-shaped loose input built into the ActorView read model.
	const talent = (kinds: string[]) =>
		buildActorView({
			items: [
				{ name: "T", type: "talent", system: { effects: kinds.map((kind) => ({ kind })) } },
				],
			});

	test("Fearless (fear-immunity) is detected", () => {
		expect(fearImmune(talent(["fear-immunity"]))).toBe(true);
		expect(fearImmune(talent(["fear-reroll"]))).toBe(false);
		expect(fearImmune(buildActorView({ items: [] }))).toBe(false);
	});

	test("Unshakeable Faith (fear-reroll) is detected; trait rows do not count", () => {
		expect(fearReroll(talent(["fear-reroll"]))).toBe(true);
		expect(
			fearReroll(
				buildActorView({
					items: [
						{
							name: "T",
							type: "trait",
							system: { effects: [{ kind: "fear-reroll" }] },
						},
					],
				}),
			),
		).toBe(false);
	});

	test("other kinds are inert", () => {
		expect(
			fearImmune(talent(["test-modifier", "damage-flat"])),
		).toBe(false);
	});

	// Pinning the behaviour change (bead 4398): the old raw walk counted any
	// talent regardless of liveness; collectEffects gates on the taxonomy, so
	// a NON-innate carrier (stowed gear) never contributes even with the kind.
	test("a non-innate item type does not contribute", () => {
		expect(
			fearImmune(
				buildActorView({
					items: [
						{
							name: "G",
							type: "gear",
							system: {
								equipState: "stowed",
								effects: [{ kind: "fear-immunity" }],
							},
						},
					],
				}),
			),
		).toBe(false);
	});
});

describe("fearSeverityModifier", () => {
	test("is a visible funnel row", () => {
		const mod = fearSeverityModifier(3);
		expect(mod.value).toBe(-20);
		expect(mod.id).toBe("fear:severity");
	});
});
