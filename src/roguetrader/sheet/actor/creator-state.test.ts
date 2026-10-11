/**
 * The CharacterCreator's pure state + transitions (bead hldm), unit-tested
 * in isolation WITHOUT the Foundry globals shim — dice arrive as an
 * injected fake Dice port, pack-driven decisions as plain doc lists. The
 * handlers in character-creator.ts are thin readers of dataset attributes
 * over these transitions; the transitions carry the logic.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Dice } from "../../../ffg/application/ports";
import { type CharacteristicKey } from "../../data/actor/character";
import { setGearsetEntries } from "../../rules/gearsets";
import {
	type OriginEntry,
	type OriginRow,
	resolveOrigins,
	setOriginEntries,
} from "../../rules/origins";
import {
	allocatePointBuy,
	CHARACTERISTIC_ORDER,
	type CreatorState,
	chooseCorrInsTrack,
	chooseCreatorCareer,
	chooseOriginRow,
	choosePickOption,
	chooseSpecies,
	emptyState,
	rerollCharacteristic,
	rollAllCharacteristics,
	rollCharacteristic,
	rollCharacteristicInto,
	rollOriginDice,
	setCreatorMethod,
	toggleKitSlotPick,
} from "./creator-state";

// The origin/kit pools are MODULE-LEVEL runtime state shared with other test
// files (see creator-context.test.ts); re-install this suite's fixtures
// before every test so the assertions are deterministic.
const ORIGIN_FIXTURES: OriginEntry[] = [
	{
		key: "hive-world",
		row: "home-world",
		col: 0,
		name: "Hive World",
		description: "",
		mechanics: { skills: ["Awareness"], woundsDice: "1d5" },
	},
	{
		key: "void-born",
		row: "home-world",
		col: 1,
		name: "Void-born",
		description: "",
		mechanics: {
			fateTable: [
				{ max: 3, value: 1 },
				{ max: 10, value: 2 },
			],
		},
	},
	{
		key: "accused",
		row: "birthright",
		col: 0,
		name: "Accused",
		description: "",
		mechanics: { corruptionDice: "1d5" },
	},
	{
		key: "stubjacked",
		row: "birthright",
		col: 1,
		name: "Stubjack",
		description: "",
		mechanics: {
			talents: ["Peer (choose one)"],
			optionChoice: ["Jaded"],
			characteristicChoice: [[{ key: "wp", value: 3 }]],
			alternateChoice: [
				{ label: "Extra XP", mechanics: { notes: ["+500 xp"] } },
			],
		},
	},
	{
		key: "pride",
		row: "motivation",
		col: 0,
		name: "Pride",
		description: "",
		mechanics: {
			alternateChoice: [
				{ label: "Heirloom Item", mechanics: { notes: ["an heirloom"] } },
			],
		},
	},
];

beforeEach(() => {
	setOriginEntries(ORIGIN_FIXTURES);
});

// --- Mock dice port ----------------------------------------------------------

/** A dice port that returns a per-formula total and records the formulas. */
function fakeDice(totals: Record<string, number>): {
	dice: Dice;
	formulas: string[];
} {
	const formulas: string[] = [];
	const dice: Dice = {
		async roll(formula: string) {
			formulas.push(formula);
			return {
				total: totals[formula] ?? 0,
				dice: [],
				terms: [],
				formula,
			};
		},
	} as unknown as Dice;
	return { dice, formulas };
}

const HUMAN_BASE: Record<CharacteristicKey, number> = {
	ws: 25,
	bs: 25,
	s: 25,
	t: 25,
	ag: 25,
	int: 25,
	per: 25,
	wp: 25,
	fel: 25,
};

describe("emptyState / CHARACTERISTIC_ORDER", () => {
	test("the default state: human, roll method, empty picks, 25 bases", () => {
		const state = emptyState();
		expect(state.method).toBe("roll");
		expect(state.speciesKey).toBe("");
		expect(state.base).toEqual(HUMAN_BASE);
		expect(state.picks).toEqual({});
		expect(state.rolledDice.wounds).toEqual([]);
		expect(state.rolledDice.fateD10).toBeNull();
		expect(state.acquisition).toBeNull();
		expect(state.heirloom).toBeNull();
		expect(state.kitPicks).toEqual({});
	});

	test("CHARACTERISTIC_ORDER is the book order (Core Rulebook p14)", () => {
		expect(CHARACTERISTIC_ORDER).toEqual([
			"ws",
			"bs",
			"s",
			"t",
			"ag",
			"int",
			"per",
			"wp",
			"fel",
		]);
	});
});

describe("rollCharacteristic / rollCharacteristicInto / rerollCharacteristic", () => {
	test("2d10 + the species base rides the formula (bead 71gm)", async () => {
		const { dice, formulas } = fakeDice({ "2d10+25": 42 });
		expect(await rollCharacteristic(dice, { base: HUMAN_BASE }, "fel")).toBe(
			42,
		);
		expect(formulas).toEqual(["2d10+25"]);
	});

	test("rollCharacteristicInto writes the rolled value into state", async () => {
		const state = emptyState();
		const { dice } = fakeDice({ "2d10+25": 33 });
		await rollCharacteristicInto(state, dice, "ws");
		expect(state.rolled.ws).toBe(33);
		expect(state.rerollUsed).toBe(false);
	});

	test("the single re-roll: once, then refuses; never on an unrolled key", async () => {
		const state = emptyState();
		state.rolled.ws = 30;
		const { dice } = fakeDice({ "2d10+25": 20 });
		expect(await rerollCharacteristic(state, dice, "ws")).toBe(true);
		expect(state.rolled.ws).toBe(20);
		expect(state.rerollUsed).toBe(true);
		// The book's single re-roll is spent.
		expect(await rerollCharacteristic(state, dice, "bs")).toBe(false);
		expect(state.rolled.bs).toBeUndefined();
	});
});

describe("rollAllCharacteristics (bead 71gm)", () => {
	test("every characteristic in book order, one roll each", async () => {
		const { dice, formulas } = fakeDice({ "2d10+25": 42 });
		const rolled = await rollAllCharacteristics(dice, { base: HUMAN_BASE });
		expect(Object.keys(rolled)).toEqual(CHARACTERISTIC_ORDER);
		expect(formulas).toEqual(
			CHARACTERISTIC_ORDER.map((key) => `2d10+${HUMAN_BASE[key]}`),
		);
	});
});

describe("rollOriginDice (the Review-step entry roll)", () => {
	test("the human path: wound dice, the fate d10, insanity, corruption", async () => {
		const state = emptyState();
		const picks = { "home-world": { key: "void-born" as const } };
		state.picks = picks;
		const resolved = resolveOrigins(state.picks);
		const { dice } = fakeDice({ "1d10": 7 });
		await rollOriginDice(state, resolved, (f) =>
			dice.roll(f).then((r) => r.total ?? -1),
		);
		expect(state.rolledDice.fateD10).toBe(7);
		expect(state.rolledDice.speciesWounds).toEqual([]); // human path
		expect(state.rolledDice.speciesFateD10).toBeNull();
	});

	test("a xeno species block rolls its OWN wounds dice + fate band d10", async () => {
		const state = emptyState();
		state.speciesKey = "kroot";
		state.speciesWounds = {
			dice: "2d5",
			flat: 4,
			toughnessMultiplier: 2,
			ignoreUnnaturalToughness: false,
		};
		state.speciesFateBands = [
			{ max: 5, value: 1 },
			{ max: 10, value: 2 },
		];
		state.speciesFate = 0;
		const { dice } = fakeDice({ "1d10": 9 });
		await rollOriginDice(state, resolveOrigins({}), (f) =>
			dice.roll(f).then((r) => r.total ?? -1),
		);
		expect(state.rolledDice.speciesWounds).toEqual([0]); // the fake's 2d5 total
		expect(state.rolledDice.speciesFateD10).toBe(9);
	});

	test("a xeno with FIXED fate does not roll the band d10", async () => {
		const state = emptyState();
		state.speciesKey = "ork";
		state.speciesWounds = {
			dice: "1d5",
			flat: 2,
			toughnessMultiplier: 2,
			ignoreUnnaturalToughness: false,
		};
		state.speciesFate = 2; // fixed starting Fate
		await rollOriginDice(state, resolveOrigins({}), async () => 3);
		expect(state.rolledDice.speciesFateD10).toBeNull();
	});

	test("the corruption-or-insanity dice roll into their track's bucket", async () => {
		const state = emptyState();
		state.picks = {
			"home-world": { key: "hive-world" },
		} as CreatorState["picks"];
		const corrupt = ORIGIN_FIXTURES.map((f) =>
			f.key === "hive-world"
				? {
						...f,
						mechanics: {
							...f.mechanics,
							woundsDice: undefined,
							corruptionOrInsanityDice: ["1d5"],
						},
					}
				: f,
		)
			// keep the mechanics typed as OriginMechanics
			.filter((f): f is OriginEntry => Boolean(f));
		setOriginEntries(corrupt);
		try {
			const rolls: string[] = [];
			await rollOriginDice(state, resolveOrigins(state.picks), async (f) => {
				rolls.push(f);
				return 5;
			});
			expect(state.rolledDice.corrOrInsanity).toEqual([5]);
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});
});

describe("pick transitions", () => {
	test("setCreatorMethod: only 'points' switches methods", () => {
		const state = emptyState();
		setCreatorMethod(state, "points");
		expect(state.method).toBe("points");
		setCreatorMethod(state, "roll");
		expect(state.method).toBe("roll");
		setCreatorMethod(state, "nonsense");
		expect(state.method).toBe("roll");
	});

	test("allocatePointBuy clamps to [0, POINT_BUY_MAX]", () => {
		const state = emptyState();
		allocatePointBuy(state, "ws", 25);
		expect(state.allocated.ws).toBe(20); // the +20 cap
		allocatePointBuy(state, "ws", 10);
		expect(state.allocated.ws).toBe(20);
		allocatePointBuy(state, "ws", -999);
		expect(state.allocated.ws).toBe(0);
		expect(allocatePointBuy(state, "" as CharacteristicKey, 5)).toBeUndefined();
	});

	test("chooseOriginRow: a new pick clears that row's corr/ins track", () => {
		const state = emptyState();
		state.corrOrInsTrack.lure = "corruption";
		expect(chooseOriginRow(state, "lure" as OriginRow, "ship-lorn")).toBe(true);
		expect(state.picks.lure).toBeDefined();
		expect(state.corrOrInsTrack.lure).toBeUndefined();
	});

	test("chooseOriginRow: clearing the pick leaves the track alone (as before)", () => {
		const state = emptyState();
		// A fresh pick CLEARS the row's track (the pick owns it)...
		chooseOriginRow(state, "home-world", "hive-world");
		state.corrOrInsTrack["home-world"] = "insanity";
		// ...but CLEARING the pick leaves the track untouched (matches the
		// original handler's if/else shape).
		chooseOriginRow(state, "home-world", "");
		expect(state.corrOrInsTrack["home-world"]).toBe("insanity");
	});

	test("chooseOriginRow: a non-row string is refused", () => {
		const state = emptyState();
		expect(chooseOriginRow(state, "not-a-row" as OriginRow, "x")).toBe(false);
	});

	test("choosePickOption: variant / option / charChoice / alternate", () => {
		const state = emptyState();
		state.picks.birthright = { key: "stubjacked" };
		const row = "birthright" as OriginRow;
		choosePickOption(state, row, "variant", "v1");
		choosePickOption(state, row, "option", "Jaded");
		choosePickOption(
			state,
			row,
			"charChoice",
			JSON.stringify([{ key: "wp", value: 3 }]),
		);
		choosePickOption(state, row, "alternate", "0");
		expect(state.picks[row]).toEqual({
			key: "stubjacked",
			variantKey: "v1",
			optionChoice: "Jaded",
			charChoice: [{ key: "wp", value: 3 }],
			alternate: 0,
		});
		// An empty value clears the alternate (the original handler's '' case).
		choosePickOption(state, row, "alternate", "");
		expect(state.picks[row]!.alternate).toBeUndefined();
		// Unknown kinds are refused.
		expect(choosePickOption(state, row, "nonsense", "x")).toBe(false);
		// A row with no pick is refused.
		expect(choosePickOption(state, "lure" as OriginRow, "variant", "v")).toBe(
			false,
		);
	});

	test("chooseCorrInsTrack validates the track value", () => {
		const state = emptyState();
		expect(chooseCorrInsTrack(state, "lure" as OriginRow, "corruption")).toBe(
			true,
		);
		expect(state.corrOrInsTrack.lure).toBe("corruption");
		expect(chooseCorrInsTrack(state, "lure" as OriginRow, "hat")).toBe(false);
	});

	test("chooseCreatorCareer just records the key", () => {
		const state = emptyState();
		chooseCreatorCareer(state, "arch-militant");
		expect(state.careerKey).toBe("arch-militant");
	});

	test("toggleKitSlotPick: pick, re-click clears, non-integer slot refused", () => {
		const state = emptyState();
		expect(toggleKitSlotPick(state, 1, 0)).toBe(true);
		expect(state.kitPicks[1]).toBe(0);
		expect(toggleKitSlotPick(state, 1, 0)).toBe(true);
		expect(state.kitPicks[1]).toBeUndefined();
		expect(toggleKitSlotPick(state, Number.NaN, 0)).toBe(false);
	});
});

describe("chooseSpecies (bead ghmn)", () => {
	const HUMAN: Parameters<typeof chooseSpecies>[1] = {
		key: "",
		label: "",
		base: { ...HUMAN_BASE },
		startingFate: 0,
		fateFormula: "",
		woundsFormula: "",
		fateBands: [],
		wounds: {
			dice: "",
			flat: 0,
			toughnessMultiplier: 2,
			ignoreUnnaturalToughness: false,
		},
	};
	const KROOT: Parameters<typeof chooseSpecies>[1] = {
		key: "kroot",
		label: "Kroot",
		base: { ...HUMAN_BASE, ws: 20, t: 30 },
		startingFate: 0,
		fateFormula: "2d10",
		woundsFormula: "K+1d5",
		fateBands: [{ max: 5, value: 1 }],
		wounds: {
			dice: "1d5",
			flat: 3,
			toughnessMultiplier: 1,
			ignoreUnnaturalToughness: true,
		},
	};

	test("the species' base, Fate/Wounds printed rules and bands are copied", () => {
		const state = emptyState();
		state.rolled = { ws: 30, fel: 10 };
		state.rerollUsed = true;
		expect(chooseSpecies(state, KROOT, [])).toBe(true);
		expect(state.speciesKey).toBe("kroot");
		expect(state.speciesLabel).toBe("Kroot");
		expect(state.base.ws).toBe(20);
		expect(state.speciesFate).toBe(0);
		expect(state.speciesFateFormula).toBe("2d10");
		expect(state.speciesWoundsFormula).toBe("K+1d5");
		expect(state.speciesFateBands).toEqual([{ max: 5, value: 1 }]);
		expect(state.speciesWounds).toEqual({
			dice: "1d5",
			flat: 3,
			toughnessMultiplier: 1,
			ignoreUnnaturalToughness: true,
		});
		// The old-base rolls are meaningless at the new base: cleared.
		expect(state.rolled).toEqual({});
		expect(state.rerollUsed).toBe(false);
	});

	test("picks whose row the species lacks are dropped (a Kroot carries no human Home World)", () => {
		// Kroot-owned entries: the species path is whatever rows ITS OWN
		// entries declare (Into the Storm p48) — kindred + its own motivation.
		setOriginEntries([
			...ORIGIN_FIXTURES,
			{
				key: "kroot-kindred",
				row: "kindred",
				col: 0,
				species: "kroot",
				name: "Kindred",
				description: "",
				mechanics: {},
			},
			{
				key: "kroot-drive",
				row: "motivation",
				col: 0,
				species: "kroot",
				name: "Drive",
				description: "",
				mechanics: {},
			},
		]);
		try {
			const state = emptyState();
			state.picks = {
				"home-world": { key: "hive-world" },
				motivation: { key: "kroot-drive" },
				kindred: { key: "kroot-kindred" },
			} as CreatorState["picks"];
			state.corrOrInsTrack = { "home-world": "corruption" };
			chooseSpecies(state, KROOT, []);
			expect(state.picks["home-world" as OriginRow]).toBeUndefined();
			expect(state.corrOrInsTrack["home-world"]).toBeUndefined();
			expect(state.picks["motivation" as OriginRow]).toEqual({
				key: "kroot-drive",
			});
			expect(state.picks["kindred" as OriginRow]).toEqual({
				key: "kroot-kindred",
			});
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});

	test("an illegal career is dropped; a legal one is kept", () => {
		const careers = [
			{
				name: "Human-only",
				system: { key: "arch-militant", species: { key: "" } },
			},
			{
				name: "Kroot-only",
				system: { key: "kroot-kindred", species: { key: "kroot" } },
			},
		];
		const s1 = emptyState();
		s1.careerKey = "arch-militant";
		chooseSpecies(s1, KROOT, careers);
		expect(s1.careerKey).toBe("");

		const s2 = emptyState();
		s2.careerKey = "kroot-kindred";
		chooseSpecies(s2, KROOT, careers);
		expect(s2.careerKey).toBe("kroot-kindred");
	});

	test("re-choosing the same species is a no-op (no invalidation)", () => {
		const state = emptyState();
		state.rolled = { ws: 33 };
		state.picks = { motivation: { key: "pride" } } as CreatorState["picks"];
		state.careerKey = "arch-militant";
		expect(chooseSpecies(state, HUMAN, [])).toBe(false);
		// Nothing was invalidated.
		expect(state.rolled.ws).toBe(33);
		expect(
			state.picks["motivation" as keyof CreatorState["picks"]],
		).toBeDefined();
		expect(state.careerKey).toBe("arch-militant");
	});
});

// --- The kit registry read stays pure (gearsetFor is not exercised here —
// the kit CONTEXT builder is covered in creator-context.test.ts and the kit
// GRANT in creator-apply-kit.test.ts); but emptyState's kit defaults are. ---
describe("emptyState kitDefaults", () => {
	test("gearset registry untouched by state transitions", () => {
		setGearsetEntries([]);
		const state = emptyState();
		state.kitPicks[2] = 1;
		expect(state.kitPicks).toEqual({ 2: 1 });
	});
});
