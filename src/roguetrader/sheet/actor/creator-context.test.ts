/**
 * PURE context + apply-side builder tests for the character creator
 * (beads a87x + 669h). The builders were extracted from CharacterCreator's
 * _prepareContext and #applyGrantsAndSummary so they test headlessly with
 * plain fixtures — WITHOUT the Foundry globals shim the class-file helpers
 * need. The adjacency rule, the vitals totals and the summary card are
 * covered here, not through a Foundry render cycle.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { GearsetEntry } from "../../data/item/gearset";
import {
	type AdvanceLedgerEntry,
	ledgerEntryFor,
	originLedgerEntry,
	totalSpent,
} from "../../rules/advancement";
import { setGearsetEntries } from "../../rules/gearsets";
import type {
	OriginEntry,
	OriginPick,
	OriginRow,
	ResolvedOrigin,
} from "../../rules/origins";

import { resolveOrigins, setOriginEntries } from "../../rules/origins";
import type { CreatorState } from "./creator-context";
import { updateLedger } from "./advancement-buy";
import {
	baseCharacteristics,
	buildAcquisitionGroups,
	buildAcquisitions,
	buildCanCreate,
	buildCareerChips,
	buildCharacteristicRows,
	buildCharacterSystemPayload,
	buildHeirloom,
	buildKitContext,
	buildOriginRows,
	buildReview,
	buildSpeciesOptions,
	buildSummaryCard,
	emptyState,
	mergeLedgerWithBaseline,
	kitOptionName,
	reconcileLegacyGrants,
	resolveCreatorVitals,
} from "./creator-context";

// --- Fixture origin chart ---------------------------------------------------

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
		key: "forge-world",
		row: "home-world",
		col: 2,
		name: "Forge World",
		description: "",
		mechanics: { characteristics: [{ key: "t", value: 5 }] },
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
		mechanics: { talents: ["Peer (choose one)"], optionChoice: ["Jaded"] },
	},
	{
		key: "tainted",
		row: "birthright",
		col: 2,
		name: "Tainted",
		description: "",
		mechanics: {},
	},
	{
		key: "ship-lorn",
		row: "lure",
		col: 0,
		name: "Ship-lorn",
		description: "",
		mechanics: { fateDelta: -1 },
	},
	{
		key: "duty",
		row: "trials",
		col: 0,
		name: "Duty",
		description: "",
		mechanics: { talents: ["Keen Hearing"] },
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

// The origin/kit pools are MODULE-LEVEL runtime state shared with
// origins.test.ts, which installs the REAL pack at collection time —
// whichever file's setter ran last wins. Re-install THIS suite's fixtures
// before every test so the assertions are deterministic regardless of
// collection order (the restored pool goes back at nothing — the pure
// builders are the only consumers here).
beforeEach(() => {
	setOriginEntries(ORIGIN_FIXTURES);
});

const localize = (key: string) => `L10N[${key}]`;

// The suite's afterAll cleanup rides the module (fixture pool restored).

function state(
	picks: Partial<Record<OriginRow, OriginPick>> = {},
): CreatorState {
	return {
		...emptyState(),
		name: "Rook",
		picks: picks as CreatorState["picks"],
	};
}

function resolved(
	picks: Partial<Record<OriginRow, OriginPick>> = {},
): ResolvedOrigin {
	return resolveOrigins(picks as CreatorState["picks"]);
}

// --- Stage 1 ----------------------------------------------------------------

describe("buildCharacteristicRows / baseCharacteristics (bead a87x)", () => {
	test("roll method: the rolled value wins, unrolled columns read base-null", () => {
		const s = { ...state(), rolled: { fel: 33 } };
		const rows = buildCharacteristicRows(s);
		const fel = rows.find((r) => r.key === "fel")!;
		const ws = rows.find((r) => r.key === "ws")!;
		expect(fel).toEqual({
			key: "fel",
			labelKey: "CHARACTERISTIC.FEL",
			rolled: 33,
			alloc: 0,
			base: 33,
		});
		expect(ws.base).toBeNull();
	});

	test("points method: base + allocated", () => {
		const s = { ...state(), method: "points" as const, allocated: { ws: 15 } };
		const ws = buildCharacteristicRows(s).find((r) => r.key === "ws")!;
		expect(ws.base).toBe(40);
		expect(baseCharacteristics(s).ws).toBe(40);
	});
});

describe("resolveCreatorVitals / buildReview (bead a87x)", () => {
	test("the human path: 2×TB + wound dice, d10 fate table, breakdowns", () => {
		const picks = { "home-world": { key: "void-born" } };
		const s = {
			...state(picks),
			rolledDice: { ...emptyState().rolledDice, wounds: [3], fateD10: 2 },
		};
		const res = resolved(picks);
		const chars = baseCharacteristics(s);
		const vitals = resolveCreatorVitals(s, res, chars);
		// TB of base-25 T = 2; 2×TB + the 1d5 wound roll of 3.
		expect(vitals.wounds).toBe(7);
		expect(vitals.fate).toBe(1); // void-born table: d10 2 -> 1
		expect(vitals.insanity).toBe(0);
		expect(vitals.corruption).toBe(0);
		expect(vitals.woundsBreakdown).toBe("2×TB + 3");
		expect(vitals.fateBreakdown).toBe("d10: 2");

		const review = buildReview(s, res, chars);
		expect(review.woundsTotal).toBe(7);
		expect(review.fateTotal).toBe(1);
		expect(review.insanityTotal).toBe(0);
		expect(review.xpTotal).toBe(5000);
		expect(review.characteristics).toHaveLength(9);
		expect(review.characteristics.find((c) => c.key === "t")!.delta).toBe(0);
	});

	test("the corruption-or-insanity track rides the CHOSEN track only", () => {
		const tainted = {
			key: "has-track",
			row: "home-world" as OriginRow,
			col: 0,
			name: "Tracky",
			description: "",
			mechanics: { corruptionOrInsanityDice: "1d5" },
		};
		setOriginEntries([...ORIGIN_FIXTURES, tainted]);
		try {
			const s = {
				...state({ "home-world": { key: "has-track" } }),
				rolledDice: { ...emptyState().rolledDice, corrOrInsanity: [4] },
				corrOrInsTrack: { "home-world": "insanity" as const },
			};
			const vitals = resolveCreatorVitals(
				s,
				resolved(s.picks),
				baseCharacteristics(s),
			);
			expect(vitals.insanity).toBe(4);
			expect(vitals.corruption).toBe(0);
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});

	test("two rows choosing different tracks split the dice (bead 02zy)", () => {
		const a = {
			key: "track-a",
			row: "home-world" as OriginRow,
			col: 0,
			name: "A",
			description: "",
			mechanics: { corruptionOrInsanityDice: "1d5" },
		};
		const b = {
			key: "track-b",
			row: "birthright" as OriginRow,
			col: 0,
			name: "B",
			description: "",
			mechanics: { corruptionOrInsanityDice: "1d5" },
		};
		setOriginEntries([...ORIGIN_FIXTURES, a, b]);
		try {
			const s = {
				...state({
					"home-world": { key: "track-a" },
					birthright: { key: "track-b" },
				}),
				rolledDice: { ...emptyState().rolledDice, corrOrInsanity: [4, 7] },
				corrOrInsTrack: {
					"home-world": "insanity" as const,
					birthright: "corruption" as const,
				},
			};
			const vitals = resolveCreatorVitals(
				s,
				resolved(s.picks),
				baseCharacteristics(s),
			);
			expect(vitals.insanity).toBe(4);
			expect(vitals.corruption).toBe(7);
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});
});

describe("buildCharacterSystemPayload (bead a87x)", () => {
	test("characteristics, xp, vitals and stored picks agree with the review", () => {
		const picks = { "home-world": { key: "hive-world" } };
		const s = {
			...state(picks),
			rolledDice: { ...emptyState().rolledDice, wounds: [2] },
		};
		const chars = baseCharacteristics(s);
		const payload = buildCharacterSystemPayload(
			s,
			resolved(picks),
			chars,
		) as Record<string, any>;
		// Wounds = 2×TB + dice (base-25 T -> TB 2): the review's math exactly.
		expect(payload.wounds).toEqual({ value: 6, max: 6 });
		expect(payload.xp).toEqual({ total: 5000, spent: 4500 });
		expect(payload.psyker).toBe(false);
		expect(payload.careerKey).toBe("");
		// Hive World is a human-row pick: persisted under its named (camelCase)
		// field by the shared storedOriginsFromPicks helper (bead ay0).
		expect((payload.origins as Record<string, string>).homeWorld).toBe(
			"hive-world",
		);
	});

	// Bead r8mw, owner shape (a) 2026-10-21: the Origin Path's xpCost rides
	// the ADVANCE LEDGER as a rank-0 creation-baseline entry, so every xp
	// reader (sheet display, dialog pool, first purchase) sees it. Into the
	// Storm p17: expanded options each cost xp (e.g. Survivalist 300).
	test("a 300 xp Origin Path rides the ledger: pool 200, first purchase preserves it", () => {
		const priced: OriginEntry[] = [
			{
				key: "survivalist",
				row: "home-world",
				col: 0,
				name: "Survivalist",
				description: "",
				mechanics: { xpCost: 300 },
			},
		];
		try {
			setOriginEntries(priced);
			const picks = { "home-world": { key: "survivalist" } };
			const s = state(picks);
			const payload = buildCharacterSystemPayload(
				s,
				resolved(picks),
				baseCharacteristics(s),
			) as Record<string, any>;
			const ledger = payload.advances as AdvanceLedgerEntry[];
			// xp.spent = 4500 baseline + 300 origin cost — derived FROM the
			// ledger, so sheet display and stored value agree.
			expect(payload.xp).toEqual({ total: 5000, spent: 4800 });
			expect(ledger).toHaveLength(1);
			expect(ledger[0]).toMatchObject({
				type: "origin",
				cost: 300,
				rank: 0,
				name: "Origin Path: Survivalist",
			});
			// The pool a creator-made character can spend: 5000 - 4800 = 200.
			expect(5000 - totalSpent(ledger)).toBe(200);
			// The first purchase does not erase the origin cost: the ledger
			// recomputation includes the creation-baseline entry.
			const next = updateLedger(
				ledger,
				ledgerEntryFor({
					key: "awareness",
					name: "Awareness",
					type: "skill",
					cost: 100,
					multiplier: 1,
					prerequisites: [],
					rank: 1,
				}),
				[],
				1,
			);
			expect((next.updates.advances as AdvanceLedgerEntry[]).some(
				(e) => e.type === "origin",
			)).toBe(true);
			expect(5000 - totalSpent(next.updates.advances as AdvanceLedgerEntry[])).toBe(
				100,
			);
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});
});

// Bead 9o5z: a creator RE-RUN on an existing actor (right-click entry) must
// be merge-preserving — the fresh payload carries ONLY the creation-baseline
// origin entry, and the update branch merges it into the actor's existing
// ledger instead of overwriting it wholesale.
describe("mergeLedgerWithBaseline (bead 9o5z)", () => {
	// An actor that advanced past creation: one skill purchase in its ledger.
	const purchaserLedger: AdvanceLedgerEntry[] = [
		ledgerEntryFor({
			key: "awareness",
			name: "Awareness",
			type: "skill",
			cost: 100,
			multiplier: 1,
			prerequisites: [],
			rank: 1,
		}),
		ledgerEntryFor({
			key: "jaded",
			name: "Jaded",
			type: "talent",
			cost: 200,
			multiplier: 1,
			prerequisites: [],
			rank: 1,
		}),
	];
	// The fresh payload's creation baseline (Into the Storm p17, e.g. 300 xp).
	const baseline: AdvanceLedgerEntry[] = [
		originLedgerEntry("Origin Path: Survivalist", 300),
	];

	test("re-run on an actor WITH purchases preserves them and keeps ONE origin entry", () => {
		const merged = mergeLedgerWithBaseline(purchaserLedger, baseline);
		// Prior purchases untouched, in place, ahead of the appended baseline.
		expect(merged).toHaveLength(3);
		expect(merged.slice(0, 2)).toEqual(purchaserLedger);
		expect(merged.filter((e) => e.type === "origin")).toHaveLength(1);
		expect(merged[2]).toEqual(baseline[0]);
		// xp.spent recomputed FROM the merged ledger: none of the purchases are
		// refunded into the pool.
		expect(totalSpent(merged)).toBe(4500 + 100 + 200 + 300);
	});

	test("re-run is IDEMPOTENT: an actor already carrying the baseline is unchanged", () => {
		const once = mergeLedgerWithBaseline(purchaserLedger, baseline);
		expect(mergeLedgerWithBaseline(once, baseline)).toEqual(once);
	});

	test("an actor WITHOUT a ledger records just the baseline (blank/legacy actor)", () => {
		expect(mergeLedgerWithBaseline(undefined, baseline)).toEqual(baseline);
		expect(mergeLedgerWithBaseline([], baseline)).toEqual(baseline);
	});

	test("a FREE first run then a priced re-run charges the new baseline (free\u2192300xp)", () => {
		// A costless first run leaves no origin entry; the priced re-run books
		// its baseline after the purchases like any other append.
		const merged = mergeLedgerWithBaseline(purchaserLedger, baseline);
		expect(merged.slice(0, 2)).toEqual(purchaserLedger);
		expect(merged[2]).toEqual(originLedgerEntry("Origin Path: Survivalist", 300));
		expect(totalSpent(merged)).toBe(4500 + 100 + 200 + 300);
	});

	test("a CHANGED-pick re-run REPLACES the stale baseline in place (name + cost re-booked)", () => {
		// Purchases BEFORE and AFTER the old baseline entry: replacement hits
		// exactly the entry's slot.
		const prior: AdvanceLedgerEntry[] = [
			purchaserLedger[0],
			originLedgerEntry("Origin Path: Hive World", 100),
			purchaserLedger[1],
		];
		const merged = mergeLedgerWithBaseline(prior, baseline);
		expect(merged).toHaveLength(3);
		expect(merged[0]).toEqual(purchaserLedger[0]);
		expect(merged[1]).toEqual(originLedgerEntry("Origin Path: Survivalist", 300));
		expect(merged[2]).toEqual(purchaserLedger[1]);
		expect(totalSpent(merged)).toBe(4500 + 100 + 200 + 300);
	});

	test("a re-run whose picks price the path at ZERO DROPS the stale baseline", () => {
		// Pricing re-derived to 0 (free combination) must not keep a stale cost
		// behind blanked picks; the purchases survive.
		const merged = mergeLedgerWithBaseline(
			[...purchaserLedger, originLedgerEntry("Origin Path: Hive World", 100)],
			[],
		);
		expect(merged).toEqual(purchaserLedger);
		expect(merged.some((e) => e.type === "origin")).toBe(false);
		expect(totalSpent(merged)).toBe(4500 + 100 + 200);
	});

	test("a no-longer-priced re-run on a BLANK ledger returns nothing", () => {
		expect(mergeLedgerWithBaseline([originLedgerEntry("Origin Path: Hive World", 100)], [])).toEqual([]);
	});

	test("MULTIPLE stale origin entries collapse to one placement (never double-booked)", () => {
		const prior: AdvanceLedgerEntry[] = [
			originLedgerEntry("Origin Path: Hive World", 100),
			purchaserLedger[0],
			originLedgerEntry("Origin Path: Forge World", 150),
			purchaserLedger[1],
		];
		const merged = mergeLedgerWithBaseline(prior, baseline);
		expect(merged.filter((e) => e.type === "origin")).toHaveLength(1);
		expect(merged).toHaveLength(3);
		expect(merged[0]).toEqual(originLedgerEntry("Origin Path: Survivalist", 300));
		expect(merged.slice(1)).toEqual([purchaserLedger[0], purchaserLedger[1]]);
	});

	test("a same-picks re-run is content-identical through the REPLACE path", () => {
		// The once-merged ledger carries the baseline as its last entry; a
		// same-picks re-run replaces that entry with identical content.
		const once = [...purchaserLedger, ...baseline];
		expect(mergeLedgerWithBaseline(once, baseline)).toEqual(once);
	});
});

// --- Stage 2 — the Origin Path adjacency ------------------------------------

describe("buildOriginRows (bead a87x)", () => {
	test("the human species offers the five core rows", () => {
		const rows = buildOriginRows(state(), []);
		expect(rows.map((r) => r.row)).toEqual([
			"home-world",
			"birthright",
			"lure",
			"trials",
			"motivation",
		]);
	});

	test("adjacency: the first row opens everything, then below + neighbours", () => {
		const first = buildOriginRows(state(), [])[0];
		// First row completely open — all three home worlds enabled.
		expect(first.options.map((o: any) => o.enabled)).toEqual([
			true,
			true,
			true,
		]);

		// A pick at column 0 allows birthright cols 0 and 1, NOT 2.
		const s2 = state({ "home-world": { key: "hive-world" } });
		const birthright = buildOriginRows(s2, [])[1];
		expect(birthright.options.map((o: any) => [o.key, o.enabled])).toEqual([
			["accused", true],
			["stubjacked", true],
			["tainted", false],
		]);
		expect(birthright.pickKey).toBe("");

		// Picking column 1 reopens column 2 below.
		const s3 = state({ "home-world": { key: "void-born" } });
		const br3 = buildOriginRows(s3, [])[1];
		expect(br3.options.map((o: any) => o.enabled)).toEqual([true, true, true]);
	});

	test("selection, the track choice (read under the ROW key) and mechanics", () => {
		const s = {
			...state({ "home-world": { key: "hive-world" } }),
			corrOrInsTrack: { "home-world": "insanity" as const },
		};
		// The detail rows use buildOriginRows' own species rows — index 0 is
		// the human Home World here.
		const home = buildOriginRows(s, [])[0];
		expect(home.pickKey).toBe("hive-world");
		const options = home.options as Array<Record<string, any>>;
		const option = options.find((o) => o.key === "hive-world")!;
		expect(option.selected).toBe(true);
		expect((home.detail as Record<string, any>).corrIns).toBe("insanity");
		expect((home.detail as Record<string, any>).skills).toEqual(["Awareness"]);
		expect((home.detail as Record<string, any>).hasCorrIns).toBe(false);
	});
});

describe("buildOriginRows — pick chips", () => {
	test("the talent-option chips resolve against the warmed catalog, else degrade", () => {
		const s = state({
			birthright: { key: "stubjacked", optionChoice: "Jaded" },
		});
		const withCatalog = (buildOriginRows(s, [
			{ key: "jaded", name: "Jaded", uuid: "Compendium.pack.Item.jaded" },
		])[1]?.detail ?? {}) as unknown as Record<string, any>;
		expect(withCatalog.hasOptions).toBe(true);
		const chip = withCatalog.options.find((o: any) => o.value === "Jaded");
		expect(chip.selected).toBe(true);
		expect(chip.link).toMatchObject({
			uuid: "Compendium.pack.Item.jaded",
			name: "Jaded",
		});
		// An option that is not a real talent degrades to plain text.
		const without = (buildOriginRows(s, [])[1]?.detail ??
			{}) as unknown as Record<string, any>;
		expect(
			without.options.find((o: any) => o.value === "Jaded").link,
		).toBeNull();
	});

	test("the alternate picks preselect (Pride's Heirloom Item)", () => {
		const spride = state({
			motivation: { key: "pride", alternate: 0 },
		});
		const prideDetail = (buildOriginRows({ ...spride }, [])[4]?.detail ??
			{}) as unknown as Record<string, any>;
		expect(prideDetail.hasAlternate).toBe(true);
		expect(prideDetail.alternates[0].selected).toBe(true);
		expect(prideDetail.pickAlternate).toBe(0);
	});
});

// --- Careers, species ---------------------------------------------------------

describe("buildCareerChips (bead a87x)", () => {
	const startingDocs = [
		{ name: "Void-Master", uuid: "cd-vm", system: { key: "void-master" } },
		{
			name: "Arch-Militant",
			uuid: "cd-am",
			system: {
				key: "arch-militant",
				suggestedHomeWorlds: ["hive-world", "forge-world"],
			},
		},
	];

	test("suggestions highlight from the picked home world (Table 1-1)", () => {
		const s = state({ "home-world": { key: "hive-world" } });
		const suggestions = new Map([
			["void-master", ["void-born"]],
			["arch-militant", ["hive-world", "forge-world"]],
		]);
		const { careers } = buildCareerChips(s, startingDocs, suggestions);
		expect(careers.map((c: any) => [c.key, c.suggested])).toEqual([
			["void-master", false],
			["arch-militant", true],
		]);
	});

	test("no home world picked: every suggestion entry counts", () => {
		const { careers } = buildCareerChips(
			state(),
			startingDocs,
			new Map([["void-master", ["void-born"]]]),
		);
		expect(careers.find((c: any) => c.key === "void-master")!.suggested).toBe(
			true,
		);
	});

	test("the selected career sets the label; unselected is empty", () => {
		expect(
			buildCareerChips(
				state({ "home-world": { key: "hive-world" } }),
				startingDocs,
				new Map(),
			).careerLabel,
		).toBe("");
		expect(
			buildCareerChips(
				{ ...state(), careerKey: "arch-militant" },
				startingDocs,
				new Map(),
			).careerLabel,
		).toBe("Arch-Militant");
	});
});

describe("buildSpeciesOptions (bead a87x)", () => {
	test("the human default localizes its label; xeno keys fall back to key/label", () => {
		const options = [
			{
				key: "",
				label: "",
				base: {} as never,
				startingFate: 0,
				fateFormula: "",
				woundsFormula: "",
				fateBands: [],
				wounds: {} as never,
			},
			{
				key: "ork",
				label: "Ork",
				base: {} as never,
				startingFate: 0,
				fateFormula: "2",
				woundsFormula: "",
				fateBands: [],
				wounds: {} as never,
			},
		];
		const out = buildSpeciesOptions(state(), options as never, localize);
		expect(out.speciesOptions[0].label).toBe("L10N[CREATOR.SPECIES_HUMAN]");
		// `label || key` — the Ork block's preferred label wins.
		expect(out.speciesOptions[1].label).toBe("Ork");
		expect(out.speciesOptions[0].selected).toBe(true);
		expect(out.speciesLabel).toBe("L10N[CREATOR.SPECIES_HUMAN]");
		expect(out.speciesFate).toBe(0);
	});
});

// --- Stage 6 — acquisitions ---------------------------------------------------

const ACQ_DOCS = [
	{
		name: "Lasgun",
		type: "ranged-weapon",
		system: {
			availability: "common",
			class: "basic",
			description: "a lasgun",
		},
		flags: { "rogue-trader": { source: "weapons" } },
		toObject: () => ({ name: "Lasgun" }),
	},
	{
		name: "Flak Vest",
		type: "armour",
		system: { availability: "abundant", description: "vest" },
		flags: { "rogue-trader": { source: "armour" } },
		toObject: () => ({ name: "Flak Vest" }),
	},
	{
		name: "Tau Rifle",
		type: "gear",
		system: { availability: "common" },
		flags: { "rogue-trader": { source: "tau-armoury" } },
		toObject: () => ({ name: "Tau Rifle" }),
	},
	{
		name: "Heirloom Locket",
		type: "gear",
		system: { availability: "common" },
		flags: { "rogue-trader": { source: "heirlooms" } },
		toObject: () => ({ name: "Heirloom Locket" }),
	},
	{
		name: "Sacrificial Knife",
		type: "melee-weapon",
		system: { availability: "scarce", class: "melee" },
		flags: { "rogue-trader": { source: "weapons" } },
		toObject: () => ({ name: "Sacrificial Knife" }),
	},
] as unknown as Parameters<typeof buildAcquisitions>[0];

const ALL_TRAINED = {
	classes: new Set(["basic", "melee"]),
	byCategory: {},
	exotic: new Set<string>(),
	sources: new Set<string>(),
};
const readSource = (doc: { flags?: Record<string, Record<string, unknown>> }) =>
	String(doc.flags?.["rogue-trader"]?.source ?? "");

describe("buildAcquisitions (bead a87x)", () => {
	test("buckets by source flag, drops non-acquisition sources", () => {
		const { options, payloads } = buildAcquisitions(
			ACQ_DOCS,
			ALL_TRAINED,
			"",
			readSource,
			localize,
		);
		// Heirlooms are not acquisitions; the Tau rifle buckets by item type.
		expect(options.some((o) => o.key.includes("Heirloom Locket"))).toBe(false);
		expect(options.some((o) => o.group === "weapons")).toBe(true);
		expect(payloads.has("tau-armoury::Tau Rifle")).toBe(true);
		// Payload map carries the full item JSON (never through the DOM).
		expect(payloads.get("weapons::Lasgun")).toEqual({ name: "Lasgun" });
		// Alphabetical across the flat list, on the same name the sort uses.
		const chipNames = options.map((o) => String(o.name));
		expect([...chipNames].sort((a, b) => a.localeCompare(b))).toEqual(
			chipNames,
		);
	});

	test("the weapon-training gate blocks untrained classes", () => {
		const { options } = buildAcquisitions(
			ACQ_DOCS,
			{
				classes: new Set(),
				byCategory: {},
				exotic: new Set(),
				sources: new Set(),
			},
			"",
			readSource,
			localize,
		);
		expect(options.find((o) => o.key === "weapons::Lasgun")!.selectable).toBe(
			false,
		);
	});

	test("the selected key preselects its chip", () => {
		const { options } = buildAcquisitions(
			ACQ_DOCS,
			ALL_TRAINED,
			"armour::Flak Vest",
			readSource,
			localize,
		);
		expect(options.find((o) => o.key === "armour::Flak Vest")!.selected).toBe(
			true,
		);
	});
});

describe("buildAcquisitionGroups (bead a2rd owner)", () => {
	const items = [
		{ key: "w1", name: "Lasgun", group: "weapons", selected: false },
		{ key: "a1", name: "Zap Vest", group: "armour", selected: true },
		{
			key: "u1",
			name: "Unbucketed",
			group: undefined,
			selected: false,
		},
	] as unknown as Array<Record<string, unknown>>;

	test("groups by type, alphabetical within, selection forces open", () => {
		const groups = buildAcquisitionGroups(items, {
			weapons: true,
			armour: false,
			gear: true,
			drugs: true,
			tools: true,
		});
		const weapons = groups.find((g) => g.key === "weapons")!;
		expect(weapons.open).toBe(false); // collapsed, nothing selected
		expect(weapons.labelKey).toBe("CREATOR.ACQ_GROUP_WEAPONS");

		const armour = groups.find((g) => g.key === "armour")!;
		expect(armour.open).toBe(true); // contains the selection
		expect(armour.count).toBe(1);
	});

	test("unbucketed items default to the gear group", () => {
		const groups = buildAcquisitionGroups(items, {});
		expect(groups.find((g) => g.key === "gear")!.count).toBe(1);
	});
});

// --- Stage 3.5 / kit / gate -----------------------------------------------------

describe("buildHeirloom", () => {
	test("pride + the 'Heirloom Item' alternative enables the roll", () => {
		expect(buildHeirloom(state())).toEqual({ enabled: false, rolled: null });
		const pride = state({ motivation: { key: "pride", alternate: 0 } });
		expect(buildHeirloom(pride).enabled).toBe(true);
		const other = state({ motivation: { key: "pride", alternate: 1 } });
		expect(buildHeirloom(other).enabled).toBe(false);
	});
});

describe("buildKitContext / kitOptionName (owner rework 2026)", () => {
	function kitFixture(): GearsetEntry {
		return {
			key: "arch-militant",
			label: "Arch-Militant Kit",
			quote: "",
			source: {},
			slots: [
				{
					quote: "fixed",
					options: [
						{ name: "Lasgun", source: "weapons", craftsmanship: "common" },
					],
				},
				{
					quote: "",
					options: [
						{ name: "Amasec", source: "gear", quantity: 2 },
						{ name: "Lho Stick", source: "gear" },
					],
				},
			],
		};
	}

	test("a fixed slot preselects; a choice slot waits for the pick", () => {
		setGearsetEntries([kitFixture()]);
		try {
			const ctx = buildKitContext({
				...state(),
				careerKey: "arch-militant",
			}) as Record<string, any>;
			expect(ctx.present).toBe(true);
			expect(ctx.complete).toBe(false); // the "or" slot is unresolved
			expect(ctx.slots[0].count).toBe(1);
			expect(ctx.slots[0].options[0].selected).toBe(true);
			expect(ctx.slots[0].options[0].name).toBe("Common-Craftsmanship Lasgun");
			expect(ctx.slots[1].options[0].name).toBe("Amasec ×2");
			expect(ctx.slots[1].options[0].selected).toBe(false);
		} finally {
			setGearsetEntries([]);
		}
	});

	test("a chosen option selects and completes", () => {
		setGearsetEntries([kitFixture()]);
		try {
			const s = {
				...state(),
				careerKey: "arch-militant",
				kitPicks: { 1: 1 },
			};
			const ctx = buildKitContext(s) as Record<string, any>;
			expect(ctx.complete).toBe(true);
			expect(ctx.slots[1].options[1].selected).toBe(true);
		} finally {
			setGearsetEntries([]);
		}
	});

	test("no kit for the career -> present: false", () => {
		expect(buildKitContext(state())).toEqual({ present: false });
	});

	test("kitOptionName: craftsmanship capitalisation + quantity hint", () => {
		expect(kitOptionName({ name: "sword", craftsmanship: "best" })).toBe(
			"Best-Craftsmanship sword",
		);
		expect(kitOptionName({ name: "sword", quantity: 3 })).toBe("sword ×3");
		expect(kitOptionName({ name: "sword" })).toBe("sword");
	});
});

describe("buildCanCreate (bead a87x)", () => {
	const pointBuy = { valid: true, total: 0, remaining: 100, overages: [] };

	test("the last-step bound stays at the call site (this.step)", () => {
		// buildCanCreate is the picker predicate only; document the split.
		const s = { ...state(), careerKey: "x" };
		expect(
			buildCanCreate(
				s,
				buildOriginRows(s, []) as never,
				pointBuy as never,
				false,
			),
		).toBe(false);
	});

	test("an unchosen row, career or invalid point-buy gates Create", () => {
		const s = {
			...state({ "home-world": { key: "hive-world" } }),
			careerKey: "arch-militant",
		};
		expect(
			buildCanCreate(
				s,
				buildOriginRows(s, []) as never,
				pointBuy as never,
				false,
			),
		).toBe(false);

		const points = {
			valid: false,
			total: 120,
			remaining: -20,
			overages: [] as string[],
		};
		const full = state({
			"home-world": { key: "hive-world" },
			birthright: { key: "accused" },
			lure: { key: "accused" },
			trials: { key: "accused" },
			motivation: { key: "pride" },
		});
		const fullPts = {
			...full,
			careerKey: "arch-militant",
			method: "points" as const,
		};
		expect(
			buildCanCreate(
				fullPts,
				buildOriginRows(fullPts, []) as never,
				points as never,
				false,
			),
		).toBe(false);
		expect(
			buildCanCreate(
				{ ...full, careerKey: "arch-militant" },
				buildOriginRows(full, []) as never,
				pointBuy as never,
				undefined, // no kit at all
			),
		).toBe(true);
	});

	test("a corruption-or-insanity row without a track choice gates Create", () => {
		const tainted = {
			key: "has-track",
			row: "lure" as OriginRow,
			col: 0,
			name: "Tracky",
			description: "",
			mechanics: { corruptionOrInsanityDice: "1d5" },
		};
		setOriginEntries([...ORIGIN_FIXTURES, tainted]);
		try {
			const s = {
				...state({
					"home-world": { key: "hive-world" },
					birthright: { key: "accused" },
					lure: { key: "has-track" },
					trials: { key: "accused" },
					motivation: { key: "pride" },
				}),
				careerKey: "arch-militant",
			};
			const rows = buildOriginRows(s, []) as Array<{
				row: string;
				detail: { hasCorrIns?: boolean } | null;
			}>;
			expect(buildCanCreate(s, rows, pointBuy as never, false)).toBe(false);
			const ok = { ...s, corrOrInsTrack: { lure: "corruption" as const } };
			expect(
				buildCanCreate(
					ok,
					buildOriginRows(ok, []) as never,
					pointBuy as never,
					undefined,
				),
			).toBe(true);
		} finally {
			setOriginEntries(ORIGIN_FIXTURES);
		}
	});
});

// --- Bead 669h — reconcile + summary card ---------------------------------------

describe("reconcileLegacyGrants (bead 669h)", () => {
	test("creator items matching the OLD picks go by id; manual items kept", () => {
		const existing = [
			{
				id: "legacy",
				type: "skill",
				name: "Awareness",
				system: { grantedBy: undefined },
			},
			{ id: "manual", type: "gear", name: "Lho Stick" },
		];
		// The fixture's Hive World grants Awareness — the legacy name. Stored
		// origins use the camelCase field names (see storedOriginPicks).
		const { deleteIds } = reconcileLegacyGrants(existing, {
			homeWorld: "hive-world",
		});
		expect(deleteIds).toContain("legacy");
		expect(deleteIds).not.toContain("manual");
	});

	test("no stored origins -> creator-granted items still wipe; manual kept", () => {
		const existing = [
			{ id: "a", type: "skill", name: "Foo", system: { grantedBy: "creator" } },
		];
		expect(reconcileLegacyGrants(existing, undefined).deleteIds).toEqual(["a"]);
		expect(
			reconcileLegacyGrants([existing[0]], { "home-world": "hive-world" })
				.deleteIds,
		).toEqual(["a"]); // a creator item goes even when unmatched (full wipe)
	});
});

describe("buildSummaryCard (bead 669h)", () => {
	test("all picked rows render through the localize seam, with variants", () => {
		const picks = { "home-world": { key: "void-born" } };
		const html = buildSummaryCard(
			{ name: "Rook", speciesKey: "", picks, careerKey: "" },
			resolved(picks),
			localize,
		);
		expect(html).toContain("<h3>Rook</h3>");
		expect(html).toContain(
			`<li><strong>L10N[ORIGIN.ROW_HOME_WORLD]:</strong> Void-born</li>`,
		);
		// Unpicked rows show the em dash.
		expect(html).toContain("<strong>L10N[ORIGIN.ROW_LURE]:</strong> —</li>");
	});

	test("profit factor signs, initiative, psyker note and the notes pointer", () => {
		const res = resolved({}) as ResolvedOrigin;
		res.profitFactor = -2;
		const without = buildSummaryCard(
			{ name: "Rook", speciesKey: "", picks: {}, careerKey: "" },
			res,
			localize,
		);
		expect(without).toContain("L10N[CREATOR.PROFIT_FACTOR]: -2");
		expect(without).toContain("L10N[CREATOR.NOTES_POINTER]");
		expect(without).not.toContain("PSYKER");

		res.initiativeBonus = 1;
		const withBonus = buildSummaryCard(
			{ name: "Rook", speciesKey: "", picks: {}, careerKey: "" },
			res,
			localize,
		);
		expect(withBonus).toContain("L10N[CREATOR.INIT_BONUS]: +1");

		const astropath = buildSummaryCard(
			{
				name: "Rook",
				speciesKey: "",
				picks: {},
				careerKey: "astropath-transcendent",
			},
			resolved({}),
			localize,
		);
		expect(astropath).toContain(
			"L10N[CREATOR.PSYKER] — L10N[CREATOR.PSY_RATING_2]",
		);
		const navigator = buildSummaryCard(
			{ name: "Rook", speciesKey: "", picks: {}, careerKey: "navigator" },
			resolved({}),
			localize,
		);
		expect(navigator).toContain("L10N[CREATOR.PSYKER]</p>");
		expect(navigator).not.toContain("PSY_RATING_2");
	});
});
