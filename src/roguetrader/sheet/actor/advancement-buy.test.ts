/**
 * PURE purchase-helper tests for the advancement dialog's #buyRow split
 * (bead avah): validateAdvancePurchase (the shared rule validator + the
 * structured prereq eval + the at-cap soft-confirm), the confirm-reason
 * assembly, updateLedger (the ledger + rank threshold math) and the
 * talent-grant branch — all with plain fixtures, NO Foundry: even the
 * talent grant takes its prompt/clone edges as injected deps.
 */
import { describe, expect, test } from "bun:test";
import type {
	AdvanceLedgerEntry,
	AdvanceRowLike,
} from "../../rules/advancement";
import {
	advanceConfirmReasons,
	applyTalentGrant,
	updateLedger,
	validateAdvancePurchase,
} from "./advancement-buy";

function row(overrides: Partial<AdvanceRowLike> = {}): AdvanceRowLike {
	return {
		key: "jaded",
		name: "Jaded",
		type: "talent",
		cost: 100,
		multiplier: 1,
		prerequisites: [],
		rank: 1,
		...overrides,
	};
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		spent: 0,
		pool: 500,
		ledger: [] as AdvanceLedgerEntry[],
		derivedRank: 1,
		characteristics: { ws: 40 },
		ownedTalents: [] as string[],
		psyRating: 0,
		ownedSkills: [] as Array<{ key?: string; name: string; ladder?: number }>,
		rowName: "",
		...overrides,
	};
}

describe("validateAdvancePurchase (bead avah)", () => {
	test("affordable in-rank rows validate clean", () => {
		const out = validateAdvancePurchase(row(), context());
		expect(out.reasons).toEqual([]);
		expect(out.unmetPrereqs).toEqual([]);
		expect(out.atCap).toBeNull();
	});

	test("beyond-rank, multiplier-exhausted and unaffordable rows give reasons", () => {
		const ranky = validateAdvancePurchase(row({ rank: 2 }), context());
		expect(ranky.reasons[0]).toContain("Rank 2");

		const multiplier = validateAdvancePurchase(
			row({ multiplier: 1 }),
			context({
				ledger: [
					{
						type: "talent",
						key: "jaded",
						name: "Jaded",
						cost: 100,
						rank: 1,
					},
				],
			}),
		);
		expect(multiplier.reasons.some((r) => r.includes("Multiplier limit"))).toBe(
			true,
		);

		const broke = validateAdvancePurchase(row({ cost: 600 }), context());
		expect(broke.reasons.some((r) => r.includes("pool"))).toBe(true);
	});

	test("MET prerequisites add nothing; an UNMET group appends its OR label", () => {
		const met = validateAdvancePurchase(
			row({ prerequisites: ["WS 40"] }),
			context({ rowName: "Jaded" }),
		);
		expect(met.unmetPrereqs).toEqual([]);

		const unmet = validateAdvancePurchase(
			row({ prerequisites: ["WS 55"] }),
			context({ rowName: "Jaded" }),
		);
		expect(unmet.unmetPrereqs).toEqual(["WS 55"]);
	});

	test("a skill at the ladder cap soft-confirms with the lang key", () => {
		const atCap = validateAdvancePurchase(
			row({ type: "skill", name: "Stealth" }),
			context({
				rowName: "Stealth",
				ownedSkills: [{ key: "stealth", name: "Stealth", ladder: 3 }],
			}),
		);
		expect(atCap.atCap).toBe("ADVANCE.AT_CAP_REASON");

		// A talent row sharing the skill's name is NOT capped (the helper
		// self-guards on row.type).
		const talent = validateAdvancePurchase(
			row({ type: "talent", name: "Stealth" }),
			context({
				rowName: "Stealth",
				ownedSkills: [{ key: "stealth", name: "Stealth", ladder: 3 }],
			}),
		);
		expect(talent.atCap).toBeNull();
	});
});

describe("advanceConfirmReasons (bead avah)", () => {
	test("assembles rule reasons + localized prereq bullets + the at-cap key", () => {
		const localize = (key: string) => `L[${key}]`;
		const format = (key: string, vars?: Record<string, string>) =>
			`F[${key}:${vars?.prereq ?? ""}]`;
		const reasons = advanceConfirmReasons(
			{
				reasons: ["Cost 600 xp exceeds the remaining pool of 500 xp."],
				unmetPrereqs: ["WS 55"],
				atCap: "ADVANCE.AT_CAP_REASON",
			},
			localize,
			format,
		);
		expect(reasons).toEqual([
			"Cost 600 xp exceeds the remaining pool of 500 xp.",
			"F[ADVANCE.PREREQ_PREFIX:WS 55]",
			"L[ADVANCE.AT_CAP_REASON]",
		]);
	});
});

describe("updateLedger (bead avah)", () => {
	// xp.spent carries the profile's preSpentBaseline (4500 = already-spent
	// starting xp, Core Rulebook p13) — the assertions account for it.
	const thresholds = [
		{ rank: 1, xpLevel: 0 },
		{ rank: 2, xpLevel: 5000 },
	];

	test("appends the entry and recomputes the spent total", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "talent", key: "old", name: "Old", cost: 100, rank: 1 },
		];
		const { updates, nextRank, rankUp } = updateLedger(
			ledger,
			{ type: "talent", key: "jaded", name: "Jaded", cost: 100, rank: 1 },
			thresholds,
			1,
		);
		expect(
			(updates.advances as AdvanceLedgerEntry[]).map((e) => e.name),
		).toEqual(["Old", "Jaded"]);
		expect(updates.xp).toEqual({ spent: 4700 });
		expect(nextRank).toBe(1);
		expect(rankUp).toBeNull();
		expect(updates.rank).toBeUndefined();
		expect(ledger).toHaveLength(1); // pure: the input ledger is untouched
	});

	test("crossing the threshold raises the Rank and flags it", () => {
		const ledger: AdvanceLedgerEntry[] = [
			{ type: "talent", key: "a", name: "A", cost: 400, rank: 1 },
		];
		const { updates, rankUp } = updateLedger(
			ledger,
			{ type: "talent", key: "b", name: "B", cost: 100, rank: 1 },
			thresholds,
			1,
		);
		expect(updates.rank).toBe(2);
		expect(rankUp).toBe(2);
	});
});

describe("applyTalentGrant (bead avah)", () => {
	const deps = (
		rows: { promptMap?: Record<string, string | null>; owned?: string[] } = {},
	) => {
		const calls: { created: object[] } = { created: [] };
		return {
			calls,
			deps: {
				promptSubject: async (name: string) =>
					name in (rows.promptMap ?? {})
						? ((rows.promptMap as Record<string, string | null>)[name] ?? null)
						: name,
				grantPayload: async (name: string) => ({ name, type: "talent" }),
				ownedTalentNames: () => rows.owned ?? [],
				createItems: async (payload: object) => {
					calls.created.push(payload);
				},
			},
		};
	};

	test("a plain row: payload built once, granted when not owned", async () => {
		const { calls, deps: d } = deps();
		const granted = await applyTalentGrant(row({ name: "Jaded" }), d);
		expect(granted).toBe(true);
		expect(calls.created.map((p: any) => p.name)).toEqual(["Jaded"]);
	});

	test("an ALREADY-OWNED talent grants nothing (idempotent, exact name)", async () => {
		const { calls, deps: d } = deps({ owned: ["Jaded"] });
		const granted = await applyTalentGrant(row({ name: "Jaded" }), d);
		expect(granted).toBe(true);
		expect(calls.created).toHaveLength(0);
	});

	test("a parameterised row prompts first; the CONCRETE subject is granted", async () => {
		const { calls, deps: d } = deps({
			promptMap: { "Peer (choose one)": "Peer (Machine Cult)" },
		});
		const granted = await applyTalentGrant(
			row({ name: "Peer (choose one)", key: "peer" }),
			d,
		);
		expect(granted).toBe(true);
		expect(calls.created.map((p: any) => `${p.name}`)).toEqual([
			"Peer (Machine Cult)",
		]);
	});

	test("a CANCELLED prompt grants nothing and reports false (no ledger)", async () => {
		const { calls, deps: d } = deps({ promptMap: { Jaded: null } });
		const granted = await applyTalentGrant(row({ name: "Jaded" }), d);
		expect(granted).toBe(false);
		expect(calls.created).toHaveLength(0);
	});
});
