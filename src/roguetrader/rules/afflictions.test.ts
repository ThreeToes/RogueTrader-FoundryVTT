import { describe, expect, test } from "bun:test";
import type { MutationRow } from "../data/item/mutation-roll";
import { buildActorView } from "../domain/model/build";
import { afflictionProcedures } from "../registry";
import {
	afflictionProcedureNames,
	applyAfflictionProcedure,
	resolveAfflictionGrants as resolveAfflictionGrantsView,
	resolveEffectValues,
} from "./afflictions";

// Phase 2: the resolver takes an ActorView. Wrapper keeps the fixtures readable.
const resolveAfflictionGrants = (items: unknown[]) =>
	resolveAfflictionGrantsView(buildActorView({ items }));

describe("resolveEffectValues (epic nt8k)", () => {
	test("rolls characteristic-modifier dice once into value", async () => {
		const resolved = await resolveEffectValues(
			[
				{ kind: "test-modifier", testKey: "skill:charm", value: -20 },
				{ kind: "characteristic-modifier", testKey: "ag", dice: "-2d10" },
			],
			async (notation) => (notation === "-2d10" ? -13 : 0),
		);
		expect(resolved).toEqual([
			{ kind: "test-modifier", testKey: "skill:charm", value: -20 },
			// dice kept for display; value is the settled (signed) roll.
			{ kind: "characteristic-modifier", testKey: "ag", dice: "-2d10", value: -13 },
		]);
	});

	test("a row that already carries a value is left untouched", async () => {
		const rows = [
			{ kind: "characteristic-modifier", testKey: "s", dice: "-1d10", value: -4 },
		];
		expect(await resolveEffectValues(rows, async () => -99)).toEqual(rows);
	});

	test("non-characteristic kinds and plain values are untouched", async () => {
		const rows = [
			{ kind: "test-modifier", testKey: "t", value: 10 },
			{ kind: "characteristic-modifier", testKey: "s", value: 10 },
			{ kind: "wounds-max", value: 5 },
		];
		expect(await resolveEffectValues(rows, async () => 0)).toEqual(rows);
	});

	test("empty / undefined effect lists are safe", async () => {
		expect(await resolveEffectValues(undefined, async () => 5)).toEqual([]);
		expect(await resolveEffectValues([], async () => 5)).toEqual([]);
	});
});

describe("resolveAfflictionGrants (epic nt8k)", () => {
	const fear = {
		name: "Vile Deformity",
		type: "mutation",
		system: {
			effects: [
				{ kind: "grants-item", testKey: "traits:Fear", label: "1" },
				{ kind: "wounds-max", value: 5 },
			],
		},
	};

	test("reads pack-qualified grants off owned afflictions", () => {
		expect(resolveAfflictionGrants([fear])).toEqual([
			{ pack: "traits", name: "Fear", benefit: "1", source: "Vile Deformity" },
		]);
	});

	test("ignores non-affliction items and non-grant kinds", () => {
		expect(
			resolveAfflictionGrants([
				{ name: "Tough Hide", type: "gear", system: fear.system },
				{ name: "Brute", type: "mutation", system: { effects: [{ kind: "wounds-max", value: 5 }] } },
			]),
		).toEqual([]);
	});

	test("collapses duplicate grants, keeps distinct benefits", () => {
		const grants = resolveAfflictionGrants([
			fear,
			{ ...fear, name: "Nightmarish", system: { effects: [{ kind: "grants-item", testKey: "traits:Fear", label: "3" }] } },
			{ ...fear, name: "Copy" },
		]);
		expect(grants.map((g) => g.benefit)).toEqual(["1", "3"]);
	});
});

// Acquisition-time procedures (beads xu83/kam1): mutations whose printed rule
// is a one-off sub-roll rather than static effect rows. Pure +
// roller-injected; the outcome carries settled effect rows AND any further
// mutations the procedure rolled up.
describe("applyAfflictionProcedure (beads xu83/kam1)", () => {
	const ctx = (
		rolls: number[],
		characteristics: Record<string, number> = {},
		mutationRows: MutationRow[] = [],
	) => {
		let i = 0;
		return {
			roll: async () => rolls[i++] ?? 0,
			characteristic: (key: string) => characteristics[key] ?? 0,
			mutationRows: async () => mutationRows,
		};
	};

	test("degenerate-mind: 1-3 grants Frenzy", async () => {
		expect(await applyAfflictionProcedure("degenerate-mind", ctx([3]))).toEqual({
			effects: [{ kind: "grants-item", testKey: "talents:Frenzy" }],
			grants: [],
		});
	});

	test("degenerate-mind: 4-7 Fearless, 8-10 From Beyond", async () => {
		expect(
			(await applyAfflictionProcedure("degenerate-mind", ctx([7]))).effects[0]
				?.testKey,
		).toBe("talents:Fearless");
		expect(
			(await applyAfflictionProcedure("degenerate-mind", ctx([10]))).effects[0]
			?.testKey,
		).toBe("traits:From Beyond");
	});

	test("degenerate-mind: an out-of-range sub-roll throws (never silent)", async () => {
		await expect(
			applyAfflictionProcedure("degenerate-mind", ctx([0])),
		).rejects.toThrow(/out of range/);
	});

	test("mental-regressive: 1-5 reduces by a rolled 1d10", async () => {
		// int: d10=3 -> -1d10(8); per/wp/fel: d10=9 -> no change.
		const out = await applyAfflictionProcedure(
			"mental-regressive",
			ctx([3, 8, 9, 9, 9]),
		);
		expect(out).toEqual({
			effects: [
				{ kind: "characteristic-modifier", testKey: "int", value: -8, label: "Mental Regressive" },
			],
			grants: [],
		});
	});

	test("mental-regressive: 6-7 stores the delta that halves the value", async () => {
		// int 35, d10=6 -> floor(35/2) = 17 -> delta -18.
		const out = await applyAfflictionProcedure(
			"mental-regressive",
			ctx([6, 9, 9, 9], { int: 35 }),
		);
		expect(out).toEqual({
			effects: [
				{ kind: "characteristic-modifier", testKey: "int", value: -18, label: "Mental Regressive" },
			],
			grants: [],
		});
	});

	test("mental-regressive: 10 stores the delta that lands on 5", async () => {
		const out = await applyAfflictionProcedure(
			"mental-regressive",
			ctx([10, 9, 9, 9], { int: 40 }),
		);
		expect(out).toEqual({
			effects: [
				{ kind: "characteristic-modifier", testKey: "int", value: -35, label: "Mental Regressive" },
			],
			grants: [],
		});
	});

	// Ravaged Body (Core Rulebook p369): "Roll 1d5 times on this table." It
	// grants further MUTATIONS rather than effect rows on itself.
	describe("ravaged-body (bead kam1)", () => {
		const rows: MutationRow[] = [
			{ tableKey: "mutations", rollMin: 1, rollMax: 25, name: "Grotesque" },
			{ tableKey: "mutations", rollMin: 26, rollMax: 50, name: "Tough Hide" },
			{ tableKey: "mutations", rollMin: 68, rollMax: 71, name: "Ravaged Body" },
			{ tableKey: "mutations", rollMin: 100, rollMax: 100, name: "Hellspawn" },
		];

		test("1d5 count, then a d100 per additional mutation, in order", async () => {
			// 1d5=3 -> 1d100 5 Grotesque, 100 Hellspawn, 30 Tough Hide.
			const out = await applyAfflictionProcedure(
				"ravaged-body",
				ctx([3, 5, 100, 30], {}, rows),
			);
			expect(out).toEqual({
				effects: [],
				grants: [
					{ name: "Grotesque", roll: 5 },
					{ name: "Hellspawn", roll: 100 },
					{ name: "Tough Hide", roll: 30 },
				],
			});
		});

		test("duplicates are kept (the book says roll N times, not re-roll)", async () => {
			const out = await applyAfflictionProcedure(
				"ravaged-body",
				ctx([2, 10, 10], {}, rows),
			);
			expect(out.grants).toEqual([
				{ name: "Grotesque", roll: 10 },
				{ name: "Grotesque", roll: 10 },
			]);
		});

		test("a count out of range throws (never silently roll nothing)", async () => {
			await expect(
				applyAfflictionProcedure("ravaged-body", ctx([0], {}, rows)),
			).rejects.toThrow(/out of range/);
		});

		test("a d100 with no covering row throws", async () => {
			await expect(
				applyAfflictionProcedure("ravaged-body", ctx([1, 60], {}, rows)),
			).rejects.toThrow(/no covering row/);
		});

		test("missing table rows throw rather than granting nothing", async () => {
			await expect(
				applyAfflictionProcedure("ravaged-body", {
					roll: async () => 1,
					characteristic: () => 0,
				}),
			).rejects.toThrow(/needs the mutation table rows/);
		});
	});

	test("a blank procedure yields no rows and no grants", async () => {
		expect(await applyAfflictionProcedure("", ctx([]))).toEqual({
			effects: [],
			grants: [],
		});
		expect(await applyAfflictionProcedure(undefined, ctx([]))).toEqual({
			effects: [],
			grants: [],
		});
	});

	test("an unknown procedure throws", async () => {
		await expect(applyAfflictionProcedure("nope", ctx([]))).rejects.toThrow(
			/Unknown affliction procedure/,
		);
	});

	test("every registered procedure has an implementation (registry drift guard)", () => {
		expect([...afflictionProcedureNames()].sort()).toEqual(
			[...afflictionProcedures.keys()].sort(),
		);
	});
});
