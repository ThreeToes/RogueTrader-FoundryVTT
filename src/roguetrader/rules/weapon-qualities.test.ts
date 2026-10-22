/**
 * Weapon-quality registry tests (bead gyei): the RT book quality table lives
 * in weapon-qualities.ts — one slug-keyed registry answering BOTH routes:
 * the funnel's test-modifier rows (accurate/defensive, pinned to their book
 * values) and the damage pipeline's roll mechanics (tearing/toxic/blast).
 * Adding a quality is ONE registration — pinned with a synthetic def that
 * edits neither the funnel nor a switch chain.
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { qualityLabelKey, type TestModifierContext } from "../../ffg/application/funnel";
import {
	matchQualityEntry,
	resetQualityWarns,
	weaponQualities,
	weaponQualitiesContributor,
} from "./weapon-qualities";

const warns: string[] = [];
let warnSpy: ReturnType<typeof spyOn> | undefined;

afterAll(() => {
	warnSpy?.mockRestore();
});
warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	warns.push(args.map(String).join(" "));
});

// Reset the captured warnings between tests so assertions stay local.
const noWarns = () => (warns.length = 0);

const attackContext = (
	special: string[],
	overrides: Partial<TestModifierContext> = {},
): TestModifierContext => ({
	kind: "attack",
	key: "bs",
	weapon: { type: "ranged-weapon", special },
	...overrides,
});

describe("weaponQualities registry (bead gyei)", () => {
	test("the five RT book qualities are seeded", () => {
		for (const slug of [
			"accurate",
			"defensive",
			"tearing",
			"toxic",
			"blast",
		]) {
			expect(weaponQualities.def(slug)?.slug, slug).toBe(slug);
		}
	});
});

describe("matchQualityEntry", () => {
	test("plain entries resolve their def, rating null", () => {
		expect(matchQualityEntry("tearing")).toMatchObject({
			def: weaponQualities.def("tearing"),
			rating: null,
		});
		expect(matchQualityEntry("  Accurate ")).toMatchObject({
			def: weaponQualities.def("accurate"),
			rating: null,
		});
	});

	test("rated entries split on the printable separators", () => {
		expect(matchQualityEntry("blast-4")?.rating).toBe(4);
		expect(matchQualityEntry("blast (3)")?.rating).toBe(3);
		expect(matchQualityEntry("Blast")).toMatchObject({
			def: weaponQualities.def("blast"),
			rating: null, // bare Blast: the def decides (blast → 0)
		});
	});

	test("unregistered qualities are inert, without a warning", () => {
		noWarns();
		expect(matchQualityEntry("reliable")).toBeNull();
		expect(matchQualityEntry("overheat")).toBeNull();
		expect(matchQualityEntry("gyro stabilised")).toBeNull();
		expect(warns).toHaveLength(0);
	});

	test("an unparseable rating warns and drops the entry loudly", () => {
		noWarns();
		// The loud symptom the bead targets: a variable rating the book prints
		// as dice (Ork Bomb Squig "Blast (1d5)") can never be a static value.
		// resetQualityWarns keeps the once-per-slug cache (below) from hiding
		// these asserts behind a warning another suite already emitted.
		resetQualityWarns();
		expect(matchQualityEntry("blast (1d5)")).toBeNull();
		expect(warns.some((w) => w.includes("blast (1d5)"))).toBe(true);
		expect(warns).toHaveLength(1);
		noWarns();
		resetQualityWarns();
		expect(matchQualityEntry("blast-4-extra")).toBeNull();
		expect(warns.some((w) => w.includes("blast-4-extra"))).toBe(true);
		resetQualityWarns();
	});

	// Bead gyei review: the same quality slug is re-parsed through several
	// routes per attack (dialog contributor + damage pipeline), so the
	// once-per-slug cache must swallow the REPEATS while the first stays loud.
	test("the same unparseable slug warns only once per session", () => {
		noWarns();
		resetQualityWarns();
		expect(matchQualityEntry("blast (1d5)")).toBeNull();
		expect(warns).toHaveLength(1);
		// Repeat parses of the same broken data (same slug, other route):
		// silent, still dropped.
		expect(matchQualityEntry("blast (1d5)")).toBeNull();
		expect(matchQualityEntry("blast-1d5")).toBeNull();
		expect(warns).toHaveLength(1);
		resetQualityWarns();
	});

	test("a flag quality with a printed rating is inert, not warned", () => {
		noWarns();
		// DH2e's "toxic-5"/"toxic (2)" are NOT RT Toxic: "none"-rating defs
		// ignore any printed rating, exactly as the old parser ignored
		// non-matching entries.
		expect(matchQualityEntry("toxic-5")).toBeNull();
		expect(matchQualityEntry("toxic (2)")).toBeNull();
		expect(warns).toHaveLength(0);
	});
});

describe("weaponQualitiesContributor", () => {
	test("accurate applies +10 on aimed attack tests only", () => {
		const aimed = weaponQualitiesContributor(
			{} as never,
			attackContext(["accurate"], { aimed: true }),
		);
		expect(aimed).toHaveLength(1);
		expect(aimed[0]).toMatchObject({
			id: "quality:accurate",
			label: "QUALITY.ACCURATE",
			value: 10,
			source: { type: "item", label: "WEAPON.SPECIAL" },
		});
		const plain = weaponQualitiesContributor(
			{} as never,
			attackContext(["accurate"]),
		);
		expect(plain).toHaveLength(0);
	});

	test("defensive imposes -10 on attack tests", () => {
		const mods = weaponQualitiesContributor(
			{} as never,
			attackContext(["defensive"]),
		);
		expect(mods).toHaveLength(1);
		expect(mods[0]).toMatchObject({
			id: "quality:defensive",
			label: "QUALITY.DEFENSIVE",
			value: -10,
		});
	});

	test("non-attack tests and roll-only qualities contribute no rows", () => {
		expect(
			weaponQualitiesContributor(
				{} as never,
				attackContext(["accurate"], { kind: "characteristic" }),
			),
		).toHaveLength(0);
		expect(
			weaponQualitiesContributor({} as never, attackContext(["tearing"])),
		).toHaveLength(0);
	});
});

describe("adding a roll-changing quality is ONE registration (bead gyei)", () => {
	// A synthetic parameterised quality, exactly how a future def (e.g.
	// "crippling") would be added: no funnel edit, no switch chain, no
	// RollMechanics interface change when it reuses an existing mechanic.
	weaponQualities.register({
		slug: "testfelling",
		rating: "optional",
		contribution: (_context, rating) => (rating ?? 0) > 0 ? 5 : null,
		mechanics: (rating) => ({ blast: rating ?? 1 }),
	});

	test("the parameterised entry reaches contribution AND mechanics", () => {
		const match = matchQualityEntry("testfelling-2");
		expect(match?.rating).toBe(2);
		const mods = weaponQualitiesContributor(
			{} as never,
			attackContext(["testfelling-2"]),
		);
		expect(mods).toHaveLength(1);
		expect(mods[0]).toMatchObject({ id: "quality:testfelling", value: 5 });
	});

	test("an unparseable rating on the new def warns and drops", () => {
		noWarns();
		resetQualityWarns();
		expect(matchQualityEntry("testfelling-crush")).toBeNull();
		expect(warns.some((w) => w.includes("testfelling-crush"))).toBe(true);
		resetQualityWarns();
	});
});

// The label key helper the contributor composes (stays in the funnel; the
// i18n parity test pins the site).
describe("qualityLabelKey", () => {
	test("kebab slugs compose QUALITY.<SLUG> keys", () => {
		expect(qualityLabelKey("gyro-stabilised")).toBe(
			"QUALITY.GYRO_STABILISED",
		);
	});
});