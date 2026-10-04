/**
 * Unit tests for the pure advancement view model (epic lzeb child 1, bead
 * anv0): plain fixtures, no Foundry — the dialog's per-row enrichment
 * (names, owned/multiplier, ladder previews, characteristic tiers,
 * affordability, prereq unmet lists, benefit tooltips, rank groups, default
 * rank chip) verified without a Foundry world.
 */

import { describe, expect, test } from "bun:test";
import {
	buildAdvancementViewModel,
	filterAdvancementRows,
	skillAtCapReason,
	type AdvancementViewModelInput,
	type PackSkillLike,
	type PackTalentLike,
} from "./advancement-view-model";
import type {
	AdvanceLedgerEntry,
	AdvanceRowLike,
} from "../../rules/advancement";

const row = (over: Partial<AdvanceRowLike> = {}): AdvanceRowLike => ({
	key: "",
	name: "",
	type: "skill",
	cost: 100,
	multiplier: 1,
	prerequisites: [],
	rank: 1,
	...over,
});

const SKILL_DOCS: PackSkillLike[] = [
	{ key: "awareness", name: "Awareness", characteristic: "per" },
	{ key: "tech-use", name: "Tech-Use", characteristic: "int" },
];

const TALENT_DOCS: PackTalentLike[] = [
	{
		key: "furious-charge",
		name: "Furious Charge",
		description: "This talent's long benefit text goes on and on.".repeat(30),
	},
];

/** Table 2-2 thresholds (Core Rulebook p38), extended with Rank 3. */
const CAREER = {
	ranks: [
		{
			rank: 1,
			xpLevel: 5000,
			advances: [
				row({ key: "awareness", type: "skill", cost: 100 }),
				row({
					key: "furious-charge",
					type: "talent",
					cost: 200,
					multiplier: 2,
					prerequisites: ["Acrobatic"],
				}),
			],
		},
		{
			rank: 2,
			xpLevel: 7000,
			advances: [
				row({ key: "tech-use", type: "skill", cost: 100, rank: 2 }),
			],
		},
		{ rank: 3, xpLevel: 10000, advances: [] },
	],
	characteristicAdvances: {
		ws: { simple: 250, intermediate: 500, trained: 750, expert: 1000 },
		// Cost 0 scheme = "not available" (packs use it to cap a stat).
		fel: { simple: 0, intermediate: 0, trained: 0, expert: 0 },
		s: { simple: 70000, intermediate: 0, trained: 0, expert: 0 },
	},
};

function makeInput(
	over: Partial<AdvancementViewModelInput> = {},
): AdvancementViewModelInput {
	return {
		// Empty ledger: totalSpent = 4,500 creation baseline (p13), so a
		// 11,000 xp total leaves a 6,500 xp pool.
		xpTotal: 11000,
		career: CAREER,
		alternateRows: [],
		ledger: [],
		characteristics: { fel: 30, ws: 40 },
		ownedTalentNames: [],
		psyRating: 0,
		ownedSkills: [],
		skillDocs: SKILL_DOCS,
		talentDocs: TALENT_DOCS,
		...over,
	};
}

function rowsFor(input: AdvancementViewModelInput) {
	const vm = buildAdvancementViewModel(input);
	return vm.rankGroups.flatMap((group) => group.rows);
}

function vmFor(input: AdvancementViewModelInput) {
	return buildAdvancementViewModel(input);
}

describe("advancement view model — name resolution precedence", () => {
	test("verbatim row.name wins over the name-by-key map", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{ rank: 1, xpLevel: 5000, advances: [row({ key: "awareness", name: "Verbatim Name" })] },
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.name).toBe("Verbatim Name");
	});

	test("empty name resolves through the pack key map (skills, then talents)", () => {
		const rows = rowsFor(makeInput()).map((r) => [r.key, r.name]);
		expect(rows).toContainEqual(["awareness", "Awareness"]);
		expect(rows).toContainEqual(["furious-charge", "Furious Charge"]);
	});

	test("unresolvable keys fall back to the raw key", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{ rank: 1, xpLevel: 5000, advances: [row({ key: "psy-rating", type: "talent" })] },
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows[0]!.name).toBe("psy-rating");
	});

	test("skill names override talent names for the same key (dialog parity)", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{ rank: 1, xpLevel: 5000, advances: [row({ key: "furious-charge", type: "skill" })] },
					],
					characteristicAdvances: {},
				},
				skillDocs: [
					{ key: "furious-charge", name: "Furious Charge (skill)", characteristic: "ws" },
				],
			}),
		);
		expect(rows[0]!.name).toBe("Furious Charge (skill)");
	});
});

describe("advancement view model — owned state + multiplier", () => {
	test("ledger purchases matching (type, key, rank) count; multiplier caps remaining", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
		];
		const rows = rowsFor(makeInput({ ledger }));
		const furious = rows.find((r) => r.key === "furious-charge")!;
		expect(furious.purchased).toBe(1);
		expect(furious.remaining).toBe(1); // multiplier 2
		const awareness = rows.find((r) => r.key === "awareness")!;
		expect(awareness.purchased).toBe(0);
		expect(awareness.remaining).toBe(1);
	});

	test("a fully purchased (multiplier 1) row has remaining 0", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
		];
		const rows = rowsFor(makeInput({ ledger }));
		expect(rows.find((r) => r.key === "awareness")!.remaining).toBe(0);
	});

	test("ledgerIndex points at the matching ledger entry for the GM refund", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
		];
		const rows = rowsFor(makeInput({ ledger }));
		const furious = rows.find((r) => r.key === "furious-charge")!;
		expect(furious.ledgerIndex).toBe(0);
		expect(rows.find((r) => r.key === "awareness")!.ledgerIndex).toBe(-1);
	});
});

describe("advancement view model — skill ladder preview", () => {
	test("unowned skill = new-skill state with the pack characteristic", () => {
		const rows = rowsFor(makeInput());
		const preview = rows.find((r) => r.key === "awareness")!.skill;
		expect(preview).toEqual({
			newSkill: true,
			currentLadder: null,
			nextLadder: 1,
			maxed: false,
			characteristic: "per",
		});
	});

	test("owned skill (matched by pack key) previews current -> current+1", () => {
		const rows = rowsFor(
			makeInput({
				ownedSkills: [{ key: "awareness", name: "Awareness", ladder: 2 }],
			}),
		);
		const preview = rows.find((r) => r.key === "awareness")!.skill;
		expect(preview!.newSkill).toBe(false);
		expect(preview!.currentLadder).toBe(2);
		expect(preview!.nextLadder).toBe(3);
		expect(preview!.maxed).toBe(false);
	});

	test("owned skill falls back to a name match when keys are absent", () => {
		// A filler entry crosses rank 2's 7,000 threshold so Tech-Use is offered.
		const filler: AdvanceLedgerEntry[] = [
			{ type: "talent", key: "filler", name: "Filler", cost: 2600, rank: 1 },
		];
		const rows = rowsFor(
			makeInput({
				ledger: filler,
				ownedSkills: [{ name: "Tech-Use", ladder: 1 }],
			}),
		);
		const preview = rows.find((r) => r.key === "tech-use")!.skill;
		expect(preview!.newSkill).toBe(false);
		expect(preview!.currentLadder).toBe(1);
		expect(preview!.nextLadder).toBe(2);
	});

	test("a keyless owned skill matching by case/trim bumps instead of regranting (bead wxkw regression)", () => {
		// The failure mode: an owned skill item with NO pack key, granted by
		// the default-skill createActor hook or an earlier purchase, whose
		// name differs from the row's data-name only by case/whitespace. The
		// preview must promise the BUMP (the live application now runs through
		// the same shared matcher, findOwnedSkillForRow) — never a new
		// ladder-1 duplicate grant.
		for (const ownedName of ["Awareness ", "awareness", "  Awareness"]) {
			const rows = rowsFor(
				makeInput({
					ownedSkills: [{ name: ownedName, ladder: 1 }],
				}),
			);
			const preview = rows.find((r) => r.key === "awareness")!.skill;
			expect(preview!.newSkill).toBe(false);
			expect(preview!.currentLadder).toBe(1);
			expect(preview!.nextLadder).toBe(2);
			expect(preview!.maxed).toBe(false);
		}
	});

	test("a maxed (ladder 3) owned skill reports maxed, capping nextLadder (bead i1f4)", () => {
		const rows = rowsFor(
			makeInput({
				ownedSkills: [{ key: "awareness", name: "Awareness", ladder: 3 }],
			}),
		);
		const preview = rows.find((r) => r.key === "awareness")!.skill;
		expect(preview!.maxed).toBe(true);
		expect(preview!.nextLadder).toBe(3);
	});

	test("out-of-range ladder 4 data (Stryxis quirk) clamps to the cap and reports maxed", () => {
		// The Edge of the Abyss statblock prints ladder 4; the view model must
		// clamp it to the three-step ladder and still treat it as maxed.
		const rows = rowsFor(
			makeInput({
				ownedSkills: [{ key: "awareness", name: "Awareness", ladder: 4 }],
			}),
		);
		const preview = rows.find((r) => r.key === "awareness")!.skill;
		expect(preview!.maxed).toBe(true);
		expect(preview!.currentLadder).toBe(3);
		expect(preview!.nextLadder).toBe(3);
	});

	test("talent rows carry no skill preview", () => {
		const rows = rowsFor(makeInput());
		expect(rows.find((r) => r.key === "furious-charge")!.skill).toBeNull();
	});
});

describe("skillAtCapReason — at-cap purchase guard (bead i1f4)", () => {
	test("a maxed owned row yields the soft-confirm reason", () => {
		const awareness = row({ key: "awareness", type: "skill", cost: 100 });
		const reason = skillAtCapReason(
			awareness,
			[{ key: "awareness", name: "Awareness", ladder: 3 }],
			"Awareness",
		);
		expect(reason).not.toBeNull();
		// Bead kcmz: the helper is pure/Foundry-free, so it returns the LANG
		// KEY — the dialog call site resolves it with game.i18n.localize.
		expect(reason).toBe("ADVANCE.AT_CAP_REASON");
	});

	test("below-cap owned and unowned rows yield no reason", () => {
		const awareness = row({ key: "awareness", type: "skill", cost: 100 });
		expect(
			skillAtCapReason(
				awareness,
				[{ key: "awareness", name: "Awareness", ladder: 2 }],
				"Awareness",
			),
		).toBeNull();
		expect(skillAtCapReason(awareness, [], "Awareness")).toBeNull();
	});

	test("non-skill rows never yield a reason", () => {
		expect(
			skillAtCapReason(
				row({ key: "furious-charge", type: "talent", cost: 200 }),
				[{ key: "furious-charge", name: "Furious Charge", ladder: 3 }],
				"Furious Charge",
			),
		).toBeNull();
	});

	test("the reason resolves through the shared matcher (keyless name match)", () => {
		// Same matcher semantics as the preview: case/trim-insensitive name
		// match against a keyless owned item still counts as at cap.
		const reason = skillAtCapReason(
			row({ key: "awareness", type: "skill", cost: 100 }),
			[{ key: "", name: " awareness ", ladder: 3 }],
			"Awareness",
		);
		expect(reason).not.toBeNull();
	});
});

describe("advancement view model — characteristic tiers", () => {
	test("purchased 0 offers the simple tier with its scheme cost + label key", () => {
		const vm = vmFor(makeInput());
		const ws = vm.characteristics.find((c) => c.key === "ws")!;
		expect(ws.purchased).toBe(0);
		expect(ws.next).toEqual({ tier: "simple", cost: 250 });
		expect(ws.tierLabelKey).toBe("ADVANCE.TIER_SIMPLE"); // 2314e96 case bug
		expect(ws.affordable).toBe(true);
	});

	test("prior +5 purchases advance through intermediate/trained/expert", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "characteristic", key: "", name: "WS simple", cost: 250, rank: 0, characteristic: "ws", tier: "simple" },
			{ type: "characteristic", key: "", name: "WS intermediate", cost: 500, rank: 0, characteristic: "ws", tier: "intermediate" },
		];
		const vm = vmFor(makeInput({ ledger }));
		const ws = vm.characteristics.find((c) => c.key === "ws")!;
		expect(ws.purchased).toBe(2);
		expect(ws.next).toEqual({ tier: "trained", cost: 750 });
		expect(ws.tierLabelKey).toBe("ADVANCE.TIER_TRAINED");
	});

	test("four purchases exhaust the scheme (next null, no tier label)", () => {
		const ledger: AdvanceLedgerEntry[] = [250, 500, 750, 1000].map((cost, i) => ({
			type: "characteristic" as const,
			key: "",
			name: `WS tier ${i}`,
			cost,
			rank: 0,
			characteristic: "ws" as const,
			tier: ["simple", "intermediate", "trained", "expert"][i]!,
		}));
		const vm = vmFor(makeInput({ ledger }));
		const ws = vm.characteristics.find((c) => c.key === "ws")!;
		expect(ws.purchased).toBe(4);
		expect(ws.next).toBeNull();
		expect(ws.tierLabelKey).toBe("");
		expect(ws.affordable).toBe(false);
	});

	test("cost-0 scheme tiers count as not available", () => {
		const vm = vmFor(makeInput());
		expect(vm.characteristics.find((c) => c.key === "fel")!.next).toBeNull();
	});

	test("no scheme entry -> exhausted row", () => {
		const vm = vmFor(makeInput());
		const ag = vm.characteristics.find((c) => c.key === "ag")!;
		expect(ag.purchased).toBe(0);
		expect(ag.next).toBeNull();
		expect(ag.affordable).toBe(false);
	});
});

describe("advancement view model — affordability", () => {
	test("cost <= pool is affordable; cost > pool is not", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "cheap", cost: 100 }),
								row({ key: "expensive", cost: 99999 }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows.find((r) => r.key === "cheap")!.affordable).toBe(true);
		expect(rows.find((r) => r.key === "expensive")!.affordable).toBe(false);
	});

	test("scheme rows compare their cost against the same pool", () => {
		const vm = vmFor(makeInput());
		// s's simple tier is 70,000 xp: unaffordable from the 6,500 pool.
		expect(vm.characteristics.find((c) => c.key === "s")!.affordable).toBe(false);
		// ws's simple tier (250) is affordable; fel is exhausted.
		expect(vm.characteristics.find((c) => c.key === "ws")!.affordable).toBe(true);
	});
});

describe("advancement view model — precomputed prerequisites", () => {
	test("unmet prereqs are listed on the row (chips, not only at purchase)", () => {
		const rows = rowsFor(makeInput());
		expect(
			rows.find((r) => r.key === "furious-charge")!.unmetPrereqs,
		).toEqual(["Acrobatic"]);
	});

	test("owned talents satisfy talent-chain prereqs", () => {
		const rows = rowsFor(makeInput({ ownedTalentNames: ["Acrobatic"] }));
		expect(rows.find((r) => r.key === "furious-charge")!.unmetPrereqs).toEqual([]);
	});

	test("characteristic thresholds evaluate against the actor snapshot", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "low", prerequisites: ["Fel 40"] }),
								row({ key: "high", prerequisites: ["Fel 30"] }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows.find((r) => r.key === "low")!.unmetPrereqs).toEqual(["FEL 40"]);
		expect(rows.find((r) => r.key === "high")!.unmetPrereqs).toEqual([]);
	});

	test("prereqText joins with a comma, prereqList with pipes", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "both", prerequisites: ["Acrobatic", "Fel 40"] }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows[0]!.prereqText).toBe("Acrobatic, Fel 40");
		expect(rows[0]!.prereqList).toBe("Acrobatic|Fel 40");
	});
});

describe("advancement view model — talent benefit tooltips", () => {
	test("talent rows carry a 300-char description slice (creator convention)", () => {
		const rows = rowsFor(makeInput());
		const furious = rows.find((r) => r.key === "furious-charge")!;
		expect(furious.benefitTooltip).toHaveLength(300);
		expect(
			furious.benefitTooltip,
		).toBe(TALENT_DOCS[0]!.description!.slice(0, 300));
		expect(rows.find((r) => r.key === "awareness")!.benefitTooltip).toBe("");
	});

	test("benefit matches case-insensitively by name when the key is empty", () => {
		const rows = rowsFor(
			makeInput({
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "", name: "furious charge", type: "talent", prerequisites: [] }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows[0]!.benefitTooltip).not.toBe("");
	});
});

describe("advancement view model — pack doc links (bead ha1y)", () => {
	/** Fixtures with uuids: the dialog passes the {key, name, uuid} catalogs. */
	const LINKED_SKILL_DOCS: PackSkillLike[] = [
		{ key: "awareness", name: "Awareness", characteristic: "per", uuid: "Compendium.rogue-trader.character-options.Item.awarenessId" },
		{ key: "tech-use", name: "Tech-Use", characteristic: "int", uuid: "Compendium.rogue-trader.character-options.Item.techUseId" },
	];
	const LINKED_TALENT_DOCS: PackTalentLike[] = [
		{
			key: "furious-charge",
			name: "Furious Charge",
			description: "This talent's long benefit text goes on and on.".repeat(30),
			uuid: "Compendium.rogue-trader.character-options.Item.furiousChargeId",
		},
	];

	test("talent rows resolve the doc uuid by key", () => {
		const rows = rowsFor(
			makeInput({
				skillDocs: LINKED_SKILL_DOCS,
				talentDocs: LINKED_TALENT_DOCS,
			}),
		);
		expect(rows.find((r) => r.key === "furious-charge")!.uuid).toBe(
			"Compendium.rogue-trader.character-options.Item.furiousChargeId",
		);
	});

	test("skill rows resolve the doc uuid by key", () => {
		const rows = rowsFor(
			makeInput({
				skillDocs: LINKED_SKILL_DOCS,
				talentDocs: LINKED_TALENT_DOCS,
			}),
		);
		expect(rows.find((r) => r.key === "awareness")!.uuid).toBe(
			"Compendium.rogue-trader.character-options.Item.awarenessId",
		);
	});

	test("keyless talent rows resolve by (case-insensitive) name — tooltip matcher parity", () => {
		const rows = rowsFor(
			makeInput({
				skillDocs: LINKED_SKILL_DOCS,
				talentDocs: LINKED_TALENT_DOCS,
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "", name: "furious charge", type: "talent" }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows[0]!.uuid).toBe(
			"Compendium.rogue-trader.character-options.Item.furiousChargeId",
		);
	});

	test("keyless skill rows resolve by exact name — grant-matcher parity", () => {
		const rows = rowsFor(
			makeInput({
				skillDocs: LINKED_SKILL_DOCS,
				talentDocs: LINKED_TALENT_DOCS,
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								row({ key: "", name: "Tech-Use", type: "skill" }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows[0]!.uuid).toBe(
			"Compendium.rogue-trader.character-options.Item.techUseId",
		);
	});

	// The direct resolver parity tests MOVED with the library (bead n2b2,
	// sheet/pack-doc-links.test.ts); the describe below keeps the view-model
	// level enrichment parity (builder-in == uuid-stamped-out).

	test("unresolvable rows carry an empty uuid (psy-rating, parameterised talents)", () => {
		const rows = rowsFor(
			makeInput({
				skillDocs: LINKED_SKILL_DOCS,
				talentDocs: LINKED_TALENT_DOCS,
				career: {
					ranks: [
						{
							rank: 1,
							xpLevel: 5000,
							advances: [
								// Key-only row with NO catalog doc.
								row({ key: "psy-rating", type: "talent" }),
								// Parameterised row: key empty, name never matches a doc.
								row({ key: "", name: "Peer (choose one)", type: "talent" }),
							],
						},
					],
					characteristicAdvances: {},
				},
			}),
		);
		expect(rows.map((r) => r.uuid)).toEqual(["", ""]);
	});

	test("docs without a uuid (older fixtures) enrich to an empty uuid, not undefined", () => {
		// uuid is an additive OPTIONAL input: plain {key, name} catalogs keep
		// working — the template's `{{#if row.uuid}}` needs a string, though.
		const rows = rowsFor(makeInput());
		expect(rows.map((r) => r.uuid)).toEqual(["", ""]);
	});
});

describe("advancement view model — rank groups and default rank chip", () => {
	test("rank groups carry threshold, spentOnRank and rank-filtered rows", () => {
		const vm = vmFor(makeInput({ xpTotal: 11500 }));
		// Empty ledger: spent 4,500 < 5,000 -> Rank 1 rows only.
		expect(vm.rankGroups).toHaveLength(1);
		expect(vm.rankGroups[0]!.rank).toBe(1);
		expect(vm.rankGroups[0]!.xpLevel).toBe(5000);
		expect(vm.rankGroups[0]!.spentOnRank).toBe(0);
		expect(vm.rankGroups[0]!.rows.map((r) => r.rank)).toEqual([1, 1]);
	});

	test("higher-rank rows are filtered out below the derived rank", () => {
		const vm = vmFor(makeInput({ xpTotal: 11500 }));
		// Spent 4,500 has NOT crossed rank 1's 5,000 threshold, so the metric
		// still points at rank 1 itself, and rank 2 rows are not offered yet.
		expect(vm.rank).toBe(1);
		expect(vm.progress).toEqual({ nextRank: 1, nextXpLevel: 5000, remaining: 500 });
		expect(vm.rankGroups.map((g) => g.rank)).toEqual([1]);
	});

	test("default chip = lowest rank with an unpurchased row", () => {
		const vm = vmFor(makeInput({ xpTotal: 11500 }));
		expect(vm.defaultRank).toBe(1);
	});

	test("once rank 1 is exhausted the chip moves to the lowest rank still unpurchased", () => {
		// Buy both rank-1 rows plus a filler entry big enough to cross
		// Rank 3's 10,000 threshold; Rank 2 (Tech-Use) stays unpurchased.
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
			{ type: "talent", key: "elite", name: "GM filler", cost: 5000, rank: 1 },
		];
		const vm = vmFor(makeInput({ ledger, xpTotal: 15000 }));
		// spent 10,000 -> Rank 3 derived; all rank-1 rows are exhausted.
		expect(vm.rank).toBe(3);
		const rank1 = vm.rankGroups.find((g) => g.rank === 1)!;
		expect(rank1.rows.every((r) => r.remaining === 0)).toBe(true);
		expect(vm.defaultRank).toBe(2);
	});

	test("everything purchased falls back to the highest held rank with rows", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
			{ type: "talent", key: "furious-charge", name: "Furious Charge", cost: 200, rank: 1 },
			{ type: "talent", key: "elite", name: "GM filler", cost: 5000, rank: 1 },
			{ type: "skill", key: "tech-use", name: "Tech-Use", cost: 100, rank: 2 },
		];
		const vm = vmFor(makeInput({ ledger, xpTotal: 15000 }));
		expect(vm.rankGroups.every((g) => g.rows.every((r) => r.remaining === 0))).toBe(true);
		expect(vm.defaultRank).toBe(2);
	});
});

describe("advancement view model — safe empty shapes", () => {
	test("empty ledger + missing career: empty groups, exhausted scheme rows, no buy", () => {
		const vm = vmFor(makeInput({ career: null, xpTotal: 11000 }));
		expect(vm.pool).toBe(6500);
		expect(vm.spent).toBe(4500);
		expect(vm.rank).toBe(1);
		expect(vm.rankGroups).toEqual([]);
		expect(vm.defaultRank).toBeNull();
		expect(vm.canBuy).toBe(false);
		// Still one row per known characteristic, all exhausted.
		expect(vm.characteristics).toHaveLength(9);
		expect(vm.characteristics.every((c) => c.next === null && c.purchased === 0 && !c.affordable)).toBe(true);
		expect(vm.progress).toEqual({ nextRank: null, nextXpLevel: null, remaining: 0 });
	});

	test("missing career with rows offered as alternates still enriches them", () => {
		const rows = rowsFor(
			makeInput({
				career: null,
				alternateRows: [{ ...row({ key: "sneak-attack", type: "talent" }), source: "pickpocket", sourceName: "Pickpocket" }],
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.name).toBe("sneak-attack");
		expect(rows[0]!.sourceName).toBe("Pickpocket");
	});

	test("canBuy requires a pool AND a career", () => {
		expect(vmFor(makeInput({ xpTotal: 4400 })).canBuy).toBe(false); // empty pool
		expect(vmFor(makeInput({ career: null })).canBuy).toBe(false);
		expect(vmFor(makeInput()).canBuy).toBe(true);
	});
});
describe("advancement view model — filter helper (epic lzeb child 2)", () => {
	const rows = vmFor(makeInput()).rankGroups[0]!.rows;

	test("no filter returns every row", () => {
		expect(filterAdvancementRows(rows, {})).toHaveLength(rows.length);
		expect(filterAdvancementRows(rows, { search: "  " })).toHaveLength(rows.length); // blank = no filter
	});

	test("search matches the resolved name", () => {
		const matched = filterAdvancementRows(rows, { search: "aware" });
		expect(matched.length).toBeGreaterThan(0);
		expect(matched.every((r) => r.name.toLowerCase().includes("aware"))).toBe(true);
	});

	test("search matches prereq text and the benefit tooltip", () => {
		// Prereq-only match (bead anv0 row: prereqs on rank-1 talent).
		const byPrereq = filterAdvancementRows(rows, { search: "acrobatic" });
		expect(byPrereq.length).toBeGreaterThan(0);
		// Tooltip-only match: the Furious Charge long description.
		const byTooltip = filterAdvancementRows(rows, {
			search: "benefit text goes",
		});
		expect(byTooltip.length).toBeGreaterThan(0);
	});

	test("affordableOnly drops over-pool and exhausted rows", () => {
		const emptyLedger = vmFor(makeInput()).rankGroups[0]!.rows;
		expect(filterAdvancementRows(emptyLedger, { affordableOnly: true }))
			.toHaveLength(emptyLedger.length);
		// Drain the pool: nothing costed is affordable.
		const broke = vmFor(makeInput({ xpTotal: 4500 })).rankGroups[0]!.rows;
		expect(filterAdvancementRows(broke, { affordableOnly: true }))
			.toHaveLength(0);
		// Multiplier exhausted rows drop even when the pool could cover them.
		const spent: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
		];
		const exhausted = vmFor(
			makeInput({ ledger: spent, xpTotal: 15000 }),
		).rankGroups[0]!.rows;
		const remaining = filterAdvancementRows(exhausted, {
			affordableOnly: true,
		});
		expect(remaining.some((r) => r.key === "awareness")).toBe(false);
	});

	test("unownedOnly drops rows already in the ledger", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "skill", key: "awareness", name: "Awareness", cost: 100, rank: 1 },
		];
		const enriched = vmFor(
			makeInput({ ledger, xpTotal: 15000 }),
		).rankGroups[0]!.rows;
		const unowned = filterAdvancementRows(enriched, { unownedOnly: true });
		expect(unowned.some((r) => r.key === "awareness")).toBe(false);
		expect(filterAdvancementRows(enriched, {})).toHaveLength(enriched.length);
	});

	test("filters compose", () => {
		const brokeUnowned = filterAdvancementRows(rows, {
			affordableOnly: true,
			unownedOnly: true,
		});
		expect(brokeUnowned.every((r) => r.affordable && r.purchased === 0)).toBe(true);
	});
});
