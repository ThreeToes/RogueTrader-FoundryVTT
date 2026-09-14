import { describe, expect, test } from "bun:test";
import {
	effectiveSorceryRank,
	isSorcerer,
	resolveCasting,
	sorceryLearnable,
	sorceryPsyRating,
} from "./casting";

describe("casting resolver (epic 0hap, Edge of the Abyss pp85-87)", () => {
	test("sorcery Psy Rating is half the Int Bonus (Sorcerer), full for Master", () => {
		// Rounding of an odd bonus is VERIFY (bead k0um): ceil matches the
		// Core Rulebook's Fettered-Psy-Rating convention.
		expect(sorceryPsyRating("sorcerer", 5)).toBe(3);
		expect(sorceryPsyRating("sorcerer", 4)).toBe(2);
		expect(sorceryPsyRating("master-sorcerer", 5)).toBe(5);
		expect(sorceryPsyRating("", 5)).toBe(0);
		expect(sorceryPsyRating("sorcerer", -3)).toBe(0);
	});

	test("Free Action powers cannot be learned through Sorcery (EA p86)", () => {
		expect(sorceryLearnable("Free Action")).toBe(false);
		expect(sorceryLearnable("free action")).toBe(false);
		expect(sorceryLearnable("Half Action")).toBe(true);
		expect(sorceryLearnable(undefined)).toBe(true);
	});

	test("non-psyker sorcerer casts as sorcery: Int test, half Int-Bonus PR, CP modifier", () => {
		const context = resolveCasting(
			{ focusTest: "Opposed Willpower", focusTime: "Half Action" },
			{
				psyker: false,
				psyRating: 0,
				sorceryRank: "sorcerer",
				corruption: 42,
				intelligenceBonus: 5,
			},
		);
		expect(context.mode).toBe("sorcery");
		expect(context.rating).toBe(3);
		expect(context.testKeyOverride).toBe("int");
		expect(context.sanctioned).toBe(false);
		expect(context.phenomenaFlat).toBe(42);
		expect(context.ritualRequired).toBe(true);
	});

	test("castAs override forces the mode on a psyker/sorcerer hybrid", () => {
		const actor = {
			psyker: true,
			psyRating: 4,
			sorceryRank: "sorcerer",
			corruption: 10,
			intelligenceBonus: 5,
		};
		const sorcerous = resolveCasting({ castAs: "sorcery" }, actor);
		expect(sorcerous.mode).toBe("sorcery");
		expect(sorcerous.rating).toBe(3);
		expect(sorcerous.testKeyOverride).toBe("int");
		// The CP modifier is per-CHARACTER, so psychic casts add it too.
		expect(sorcerous.phenomenaFlat).toBe(10);

		const psychic = resolveCasting({ castAs: "psychic" }, actor);
		expect(psychic.mode).toBe("psychic");
		expect(psychic.rating).toBe(4);
		expect(psychic.testKeyOverride).toBe("");
		expect(psychic.phenomenaFlat).toBe(10);
	});

	test("a psyker with a sorcery rank defaults to psychic", () => {
		const context = resolveCasting(
			{ focusTest: "Willpower", focusTime: "Half Action" },
			{
				psyker: true,
				psyRating: 4,
				sorceryRank: "master-sorcerer",
				corruption: 5,
				intelligenceBonus: 6,
			},
		);
		expect(context.mode).toBe("psychic");
		expect(context.rating).toBe(4);
		expect(context.phenomenaFlat).toBe(5);
	});

	test("sanctioned flag flows through for the psychic row (default true)", () => {
		expect(
			resolveCasting({}, { psyker: true, psyRating: 2, sanctioned: false })
				.sanctioned,
		).toBe(false);
		expect(resolveCasting({}, { psyker: true, psyRating: 2 }).sanctioned).toBe(
			true,
		);
	});

	test("effective rank: talents win, the manual field is the fallback", () => {
		expect(effectiveSorceryRank(0, "")).toBe("");
		expect(effectiveSorceryRank(0, "sorcerer")).toBe("sorcerer");
		expect(effectiveSorceryRank(1, "")).toBe("sorcerer");
		expect(effectiveSorceryRank(2, "sorcerer")).toBe("master-sorcerer");
		expect(effectiveSorceryRank(0, "bogus")).toBe("");
	});

	test("isSorcerer reflects the rank", () => {
		expect(isSorcerer({ sorceryRank: "sorcerer" })).toBe(true);
		expect(isSorcerer({ sorceryRank: "" })).toBe(false);
	});
});
