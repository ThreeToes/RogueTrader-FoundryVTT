import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	careersForSpecies,
	CREATOR_LAST_STEP,
	creatorCanAdvance,
	finalCharacteristics,
	HUMAN_SPECIES_KEY,
	isUnresolvedChoice,
	matchOriginSkills,
	POINT_BUY_BUDGET,
	POINT_BUY_MAX,
	speciesKeyOf,
	speciesOptions,
	validatePointBuy,
	woundsFromOrigin,
	type CatalogSkill,
	type ResolvedOrigin,
} from "./creation";

describe("validatePointBuy (Core Rulebook p14)", () => {
	test("empty allocation is valid with the full budget remaining", () => {
		const result = validatePointBuy({});
		expect(result.total).toBe(0);
		expect(result.remaining).toBe(POINT_BUY_BUDGET);
		expect(result.valid).toBe(true);
	});

	test("budget spread across characteristics is valid", () => {
		const result = validatePointBuy({
			ws: 10, bs: 10, s: 10, t: 10,
			ag: 10, int: 10, per: 10, wp: 10, fel: 20,
		});
		expect(result.total).toBe(100);
		expect(result.remaining).toBe(0);
		expect(result.valid).toBe(true);
	});

	test("over-budget allocation is invalid", () => {
		const result = validatePointBuy({
			ws: 20, bs: 20, s: 20, t: 20,
			ag: 10, int: 10, per: 10, wp: 10, fel: 10,
		});
		expect(result.total).toBe(130);
		expect(result.valid).toBe(false);
	});

	test("over-cap characteristic is flagged", () => {
		const result = validatePointBuy({ ws: POINT_BUY_MAX + 1, t: 20 });
		expect(result.overCap).toEqual(["ws"]);
		expect(result.valid).toBe(false);
	});
});

describe("finalCharacteristics", () => {
	test("applies origin deltas and clamps to 0-100", () => {
		const base = { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 };
		const result = finalCharacteristics(base, { wp: 5, fel: -5, t: 75 });
		expect(result.wp).toBe(35);
		expect(result.fel).toBe(25);
		expect(result.t).toBe(100);
	});
});

describe("woundsFromOrigin (p17-24 home world sections)", () => {
	test("double TB plus dice totals plus flat bonus", () => {
		// Death world: 2xTB + 1d5+2 (rolled 5) => TB 3 -> 6+5+2 = 13.
		expect(woundsFromOrigin(3, [7], 0)).toBe(13);
		// Endurance motivation adds +1 wound.
		expect(woundsFromOrigin(3, [7], 1)).toBe(14);
		// Void born 1d5 rolled 1: 2*TB + 1.
		expect(woundsFromOrigin(4, [1], 0)).toBe(9);
	});
});

describe("matchOriginSkills", () => {
	const catalog: CatalogSkill[] = [
		{ name: "Survival", characteristic: "int" },
		{ name: "Forbidden Lore", characteristic: "int" },
		{ name: "Speak Language (Low Gothic)", characteristic: "int" },
		{ name: "Tech-Use", characteristic: "int" },
	];

	const resolved = (skills: string[], options: string[] = []): ResolvedOrigin =>
		({
			skills,
			options,
			characteristics: {},
			talents: [],
			woundsDice: [],
			woundBonus: 0,
			fateTable: null,
			fateDelta: 0,
			insanity: 0,
			insanityDice: [],
			corruption: 0,
			corruptionDice: [],
			corruptionOrInsanityDice: [],
			initiativeBonus: 0,
			profitFactor: 0,
			notes: [],
		}) as unknown as ResolvedOrigin;

	test("exact catalog names grant with catalog characteristics", () => {
		const { grants, unmatched } = matchOriginSkills(
			resolved(["Survival", "Tech-Use"]),
			catalog,
		);
		expect(grants).toHaveLength(2);
		expect(grants[0]).toEqual({
			name: "Survival",
			type: "skill",
			system: { characteristic: "int", ladder: 1 },
		});
		expect(unmatched).toHaveLength(0);
	});

	test("specialization form clones the base skill's characteristic", () => {
		const { grants, unmatched } = matchOriginSkills(
			resolved(["Speak Language (Ship Dialect)"]),
			catalog,
		);
		expect(grants).toHaveLength(1);
		expect(grants[0]?.name).toBe("Speak Language (Ship Dialect)");
		expect(grants[0]?.system.characteristic).toBe("int");
		expect(unmatched).toHaveLength(0);
	});

	test("unknown names land in unmatched, never silently dropped", () => {
		const { unmatched } = matchOriginSkills(
			resolved(["Common Lore (Machine Cult)"]),
			catalog,
		);
		expect(unmatched).toEqual(["Common Lore (Machine Cult)"]);
	});

	test("options are matched too", () => {
		const { grants } = matchOriginSkills(resolved([], ["Survival"]), catalog);
		expect(grants).toHaveLength(1);
	});
});

describe("isUnresolvedChoice", () => {
	test("flags 'choose one' placeholders", () => {
		expect(isUnresolvedChoice("Forbidden Lore (choose one)")).toBe(true);
		expect(isUnresolvedChoice("Hatred (choose one)")).toBe(true);
		expect(isUnresolvedChoice("Peer (Underworld)")).toBe(false);
	});
});

describe("creatorCanAdvance (character-creator Next gate, fix 2026-09-14)", () => {
	test("every step before the last always advances", () => {
		// Regression: the creator passed raw canCreate (step === 3 && ...) as the
		// nav partial's forwardDisabled, which disabled Next on steps 0-2.
		expect(creatorCanAdvance(0, false)).toBe(true);
		expect(creatorCanAdvance(1, false)).toBe(true);
		expect(creatorCanAdvance(2, false)).toBe(true);
	});

	test("the final Create step needs the full validation", () => {
		// Bead ghmn: the Species step made equipment step 4 the last one.
		expect(creatorCanAdvance(CREATOR_LAST_STEP, false)).toBe(false);
		expect(creatorCanAdvance(CREATOR_LAST_STEP, true)).toBe(true);
		expect(CREATOR_LAST_STEP).toBe(4);
	});

	// The wizard's step count lives in FOUR places: this constant, the creator's
	// canCreate/onNext bounds, and the template's sections + nav. Adding the
	// Species step (bead ghmn) meant touching all of them, so pin the template
	// to the constant — otherwise a forgotten section silently hides a step.
	describe("step bounds match the template (bead ghmn)", () => {
		const template = readFileSync(
			"template/sheet/actor/character-creator.hbs",
			"utf8",
		);

		test("every step from 0..last has a rendered section", () => {
			for (let step = 0; step <= CREATOR_LAST_STEP; step++) {
				expect(template, `section for step ${step}`).toContain(
					`{{#if (eq step ${step})}}`,
				);
			}
		});

		test("the template renders no step beyond the last", () => {
			expect(template).not.toContain(`{{#if (eq step ${CREATOR_LAST_STEP + 1})}}`);
		});

		test("the nav marks the last step as the primary Create action", () => {
			expect(template).toContain(`(ifThen (eq step ${CREATOR_LAST_STEP}) "create" "next")`);
			expect(template).toContain(`forwardPrimary=(eq step ${CREATOR_LAST_STEP})`);
		});

		test("the step labels are translated in all four languages", () => {
			for (const lang of ["en", "es", "fr", "pl"]) {
				const dict = JSON.parse(
					readFileSync(`lang/${lang}.json`, "utf8"),
				) as Record<string, string>;
				for (const key of [
					"CREATOR.STEP_SPECIES",
					"CREATOR.STEP_CHARACTERISTICS",
					"CREATOR.STEP_ORIGIN",
					"CREATOR.STEP_REVIEW",
				]) {
					expect(dict[key], `${lang}:${key}`).toBeTruthy();
				}
			}
		});
	});
});

// Bead ghmn: the creator's species list comes from the CAREERS compendium
// (species blocks on the career docs) — never from code.
//
// These fixtures are deliberately INVENTED (a "squat" species and joke
// careers): this suite tests the DERIVATION, and must never carry book values,
// so that a change to the real pack can never be masked by a copy of it here.
// The pack-driven guarantee lives in src/packs/rogue_trader/careers/
// careers.test.ts, which asserts the derived options equal the YAML.
describe("species options from the careers pack (bead ghmn)", () => {
	const squat = {
		key: "squat",
		label: "Squat",
		baseCharacteristics: {
			ws: 31,
			bs: 17,
			s: 42,
			t: 40,
			ag: 19,
			int: 22,
			per: 23,
			wp: 29,
			fel: 13,
		},
		startingFate: 0,
		fateFormula: "Roll 1d3: on a 1, nothing; on a 2-3, something.",
		woundsFormula: "Twice the Toughness Bonus plus 1d5.",
	};
	const voidSpecies = {
		key: "void-species",
		label: "Void",
		baseCharacteristics: { ws: 11, bs: 12, s: 13, t: 14, ag: 15, int: 16, per: 17, wp: 18, fel: 19 },
		startingFate: 2,
	};

	test("human is always the first option and is the ABSENCE of a species", () => {
		const options = speciesOptions([]);
		expect(options).toHaveLength(1);
		expect(options[0].key).toBe(HUMAN_SPECIES_KEY);
		expect(options[0].base.ws).toBe(25);
		expect(options[0].base.fel).toBe(25);
	});

	test("each distinct species block in the pack becomes an option", () => {
		const options = speciesOptions([squat, voidSpecies]);
		expect(options.map((o) => o.key)).toEqual(["", "squat", "void-species"]);
		// The pack's bases are carried through verbatim, not recomputed.
		expect(options[1].base.s).toBe(42);
		expect(options[1].base.fel).toBe(13);
		expect(options[2].base.fel).toBe(19);
	});

	test("two careers sharing a species collapse to ONE option", () => {
		const options = speciesOptions([voidSpecies, { ...voidSpecies }]);
		expect(options.filter((o) => o.key === "void-species")).toHaveLength(1);
	});

	test("blank/absent species blocks never create an option", () => {
		const options = speciesOptions([{ key: "" }, { key: "   " }, undefined, {}]);
		expect(options).toHaveLength(1);
	});

	test("a characteristic the pack omits keeps the human base", () => {
		// The pack stores the book's "2d10+" adds, so an absent key means
		// "unchanged" rather than zero.
		const options = speciesOptions([{ key: "partial", baseCharacteristics: { ws: 31 } }]);
		expect(options[1].base.ws).toBe(31);
		expect(options[1].base.fel).toBe(25);
	});

	test("verbatim species formulas are carried through for display", () => {
		const options = speciesOptions([squat, voidSpecies]);
		expect(options[1].fateFormula).toContain("1d3");
		expect(options[1].woundsFormula).toContain("Toughness Bonus");
		expect(options[2].startingFate).toBe(2);
	});

	test("a custom human base is honoured (caller-supplied, not hardcoded)", () => {
		const options = speciesOptions([{ key: "x", baseCharacteristics: { ws: 31 } }], 20);
		expect(options[0].base.ws).toBe(20);
		expect(options[1].base.fel).toBe(20);
	});
});

describe("career species binding (bead ghmn)", () => {
	const docs = [
		{ name: "Ice Cream Man", species: { key: "" } },
		{ name: "Official Cat Food Taster" },
		{ name: "Ice Cream Man (Squat)", species: { key: "squat" } },
		{ name: "Senior Cat Food Taster", species: { key: "squat" } },
		{ name: "Void Lollipop Vendor", species: { key: "void-species" } },
	];

	test("speciesKeyOf treats a missing block as human", () => {
		expect(speciesKeyOf(docs[0])).toBe("");
		expect(speciesKeyOf(docs[1])).toBe("");
		expect(speciesKeyOf(docs[2])).toBe("squat");
	});

	test("careersForSpecies returns exactly the species' own careers", () => {
		expect(careersForSpecies(docs, "").map((d) => d.name)).toEqual([
			"Ice Cream Man",
			"Official Cat Food Taster",
		]);
		expect(careersForSpecies(docs, "squat").map((d) => d.name)).toEqual([
			"Ice Cream Man (Squat)",
			"Senior Cat Food Taster",
		]);
		expect(careersForSpecies(docs, "void-species").map((d) => d.name)).toEqual([
			"Void Lollipop Vendor",
		]);
	});

	test("an unknown species yields no careers rather than everything", () => {
		expect(careersForSpecies(docs, "tau")).toEqual([]);
	});
});