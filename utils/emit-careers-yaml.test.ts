/**
 * Direct guards for the hand-curated, fail-loud maps in
 * `utils/emit-careers-yaml.ts` (bead 1tfk). They were previously exercised
 * only indirectly through the emitted pack YAML, so a broken map surfaced as
 * an opaque diff in `src/packs/.../careers.yaml` rather than a named failure.
 *
 * careers.yaml is a LIVING hand-curated file: nothing here regenerates or
 * writes it. `emit-careers-yaml.ts` keeps its emit pipeline behind
 * `import.meta.main`, so importing the module is inert and only the exported
 * functions/maps are touched.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	keyAdvance,
	matchesPack,
	PARAGRAPH_STARTS,
	SUGGESTED_HOME_WORLDS,
	splitParagraphs,
	TYPO_KEY_MAP,
	toDescriptionHtml,
} from "./emit-careers-yaml";

// keyAdvance resolves against the real skill/talent/trait packs, which are
// machine-local in the private packs clone (same skip convention as
// utils/shipped-text.test.ts and utils/source-pages.test.ts).
const HAS_PACKS =
	existsSync("src/packs/rogue_trader/character-options/skills.yaml") &&
	existsSync("src/packs/rogue_trader/character-options/talents.yaml") &&
	existsSync("src/packs/rogue_trader/character-options/traits.yaml");

describe("SUGGESTED_HOME_WORLDS", () => {
	test("the Rogue Trader career lists its Table 1-1 home worlds (p24)", () => {
		expect(SUGGESTED_HOME_WORLDS["rogue-trader"]).toEqual([
			"hive-world",
			"imperial-world",
			"noble-born",
			"void-born",
		]);
	});

	test("every core career key has a non-empty suggested list", () => {
		const coreCareers = [
			"rogue-trader",
			"arch-militant",
			"astropath-transcendent",
			"explorator",
			"missionary",
			"navigator",
			"seneschal",
			"void-master",
		];
		for (const key of coreCareers) {
			expect(SUGGESTED_HOME_WORLDS[key]?.length).toBeGreaterThan(0);
		}
	});

	test("an unknown career key is absent (the emit site then yields [])", () => {
		// Not fail-loud by design: a key miss silently produces no
		// suggestions, which is why this map is pinned against the career keys.
		expect(SUGGESTED_HOME_WORLDS["no-such-career"]).toBeUndefined();
	});
});

describe("TYPO_KEY_MAP", () => {
	test("maps the book's verified misspellings to pack keys", () => {
		expect(TYPO_KEY_MAP.Decieve).toBe("deceive");
		expect(TYPO_KEY_MAP["Totall Recall"]).toBe("total-recall");
		expect(TYPO_KEY_MAP["Good Repuatation (Ecclesiarchy)"]).toBe(
			"good-reputation",
		);
		expect(TYPO_KEY_MAP.Navigate).toBe("navigation");
	});

	test("correctly spelled names are not patched", () => {
		expect(TYPO_KEY_MAP.Deceive).toBeUndefined();
		expect(TYPO_KEY_MAP["Total Recall"]).toBeUndefined();
	});
});

describe("matchesPack", () => {
	test("exact pack name wins", () => {
		expect(matchesPack("Awareness", new Set(["Awareness"]))).toBe("Awareness");
	});

	test("hyphens normalise to spaces", () => {
		expect(matchesPack("Iron Discipline", new Set(["Iron-Discipline"]))).toBe(
			"Iron-Discipline",
		);
	});

	test("prefix-tolerant match recovers a clipped book name", () => {
		// The talents pack once carried "Iron Discipl" (bead 3mj).
		expect(matchesPack("Iron Discipl", new Set(["Iron Discipline"]))).toBe(
			"Iron Discipline",
		);
	});

	test("a generic book name prefix-matches a specialization", () => {
		// keyAdvance relies on this: "Drive (Ground Vehicles)" is tried as
		// "Drive" after the exact and plural variants miss.
		expect(matchesPack("Drive", new Set(["Drive (Ground Vehicle)"]))).toBe(
			"Drive (Ground Vehicle)",
		);
	});

	test("singular/plural suffixes are not normalised (generic fallback covers them)", () => {
		// Pinned so nobody assumes plural tolerance: the book's
		// "Drive (Ground Vehicles)" is NOT matched here; keyAdvance falls back
		// to the generic "Drive" prefix match above instead.
		expect(
			matchesPack(
				"Drive (Ground Vehicles)",
				new Set(["Drive (Ground Vehicle)"]),
			),
		).toBeNull();
	});

	test("pack names shorter than 8 chars are never prefix-matched", () => {
		// Without the guard, "Ironwork".startsWith("Iron") would match.
		expect(matchesPack("Ironwork", new Set(["Iron"]))).toBeNull();
	});

	test("unrelated names fail loud (null) instead of guessing", () => {
		expect(matchesPack("Made-up Talent", new Set(["Awareness"]))).toBeNull();
	});
});

describe("keyAdvance", () => {
	test("typo row resolves through TYPO_KEY_MAP to the pack key", () => {
		expect(keyAdvance("Decieve", "skill")).toEqual({
			key: "deceive",
			name: "",
			multiplier: 1,
		});
	});

	test("(xN) suffix becomes the multiplier, name still resolves", () => {
		expect(keyAdvance("Totall Recall (x2)", "talent")).toEqual({
			key: "total-recall",
			name: "",
			multiplier: 2,
		});
	});

	test("trailing page number (page furniture glue) is stripped", () => {
		expect(keyAdvance("Decieve 42", "skill")).toEqual({
			key: "deceive",
			name: "",
			multiplier: 1,
		});
	});

	test("(Choose One) rows stay verbatim and are reported, never keyed", () => {
		expect(keyAdvance("Trade (Choose One)", "skill")).toEqual({
			key: "",
			name: "Trade (Choose One)",
			multiplier: 1,
		});
	});

	test("unresolvable rows keep the verbatim name and an empty key", () => {
		expect(keyAdvance("Made-up Talent", "talent")).toEqual({
			key: "",
			name: "Made-up Talent",
			multiplier: 1,
		});
	});

	describe.skipIf(!HAS_PACKS)("against the real packs", () => {
		test("skill resolves to its slug", () => {
			expect(keyAdvance("Awareness", "skill")).toEqual({
				key: "awareness",
				name: "",
				multiplier: 1,
			});
		});

		test("+10 ladder row resolves to the base skill", () => {
			expect(keyAdvance("Awareness +10", "skill")).toEqual({
				key: "awareness",
				name: "",
				multiplier: 1,
			});
		});

		test("specialization falls back to the base skill", () => {
			expect(keyAdvance("Common Lore (Imperium)", "skill")).toEqual({
				key: "common-lore",
				name: "",
				multiplier: 1,
			});
		});

		test("plural book form resolves through the generic base skill", () => {
			// Book prints "Drive (Ground Vehicles)" (p60 etc.), the pack has the
			// singular; the emitted key is the base Drive entry.
			expect(keyAdvance("Drive (Ground Vehicles)", "skill")).toEqual({
				key: "drive-ground-vehicle",
				name: "",
				multiplier: 1,
			});
		});

		test("talent resolves to its slug", () => {
			expect(keyAdvance("Total Recall", "talent")).toEqual({
				key: "total-recall",
				name: "",
				multiplier: 1,
			});
		});

		test("specialized talent falls back to the base talent", () => {
			expect(keyAdvance("Hatred (Pirates)", "talent")).toEqual({
				key: "hatred",
				name: "",
				multiplier: 1,
			});
		});

		test("trait resolves to its slug", () => {
			expect(keyAdvance("Brutal Charge", "trait")).toEqual({
				key: "brutal-charge",
				name: "",
				multiplier: 1,
			});
		});
	});
});

describe("splitParagraphs / PARAGRAPH_STARTS", () => {
	test("a marker at a sentence start begins a new paragraph", () => {
		expect(
			splitParagraphs("Alpha beta. Gamma delta epsilon. Zeta eta.", ["Gamma"]),
		).toEqual(["Alpha beta.", "Gamma delta epsilon. Zeta eta."]);
	});

	test("a marker as the very first sentence does not open an empty paragraph", () => {
		expect(splitParagraphs("Gamma delta. Epsilon zeta.", ["Gamma"])).toEqual([
			"Gamma delta. Epsilon zeta.",
		]);
	});

	test("an unmatched marker leaves the block as one paragraph", () => {
		// The loud failure lives in toDescriptionHtml, below.
		expect(splitParagraphs("Alpha beta. Gamma delta.", ["Zeta"])).toEqual([
			"Alpha beta. Gamma delta.",
		]);
	});

	test("every career's markers are non-empty verbatim sentence prefixes", () => {
		for (const [careerKey, markers] of Object.entries(PARAGRAPH_STARTS)) {
			expect(markers.length).toBeGreaterThan(0);
			for (const marker of markers) {
				expect(marker.trim()).toBe(marker);
				expect(marker.length).toBeGreaterThan(0);
			}
			expect(careerKey.length).toBeGreaterThan(0);
		}
	});
});

describe("toDescriptionHtml marker guard", () => {
	test("matched markers produce <p> breaks and keep the prose verbatim", () => {
		const html = toDescriptionHtml(
			"Opening line here. The Arch-militant is an expert in every form of combat. Closing line.",
			"arch-militant",
		);
		expect(html).toContain(
			"<p>Opening line here.</p>\n<p>The Arch-militant is an expert in every form of combat. Closing line.</p>",
		);
	});

	test("prose drift (marker missing) throws loudly", () => {
		expect(() =>
			toDescriptionHtml("Nothing relevant in this prose.", "arch-militant"),
		).toThrow(/paragraph marker not matched/);
	});

	test("a career with no curated markers is exempt", () => {
		expect(toDescriptionHtml("Just prose.", "no-such-career")).toBe(
			"<p>Just prose.</p>",
		);
	});
});
