import { describe, expect, test } from "bun:test";
import { afflictionProcedures } from "../registry";
import {
	afflictionProcedureNames,
	applyAfflictionProcedure,
	resolveAfflictionGrants,
	resolveEffectValues,
} from "./afflictions";

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

// Acquisition-time procedures (bead xu83): mutations whose printed rule is a
// one-off sub-roll rather than static effect rows. Pure + roller-injected.
describe("applyAfflictionProcedure (bead xu83)", () => {
	const ctx = (
		rolls: number[],
		characteristics: Record<string, number> = {},
	) => {
		let i = 0;
		return {
			roll: async () => rolls[i++] ?? 0,
			characteristic: (key: string) => characteristics[key] ?? 0,
		};
	};

	test("degenerate-mind: 1-3 grants Frenzy", async () => {
		expect(await applyAfflictionProcedure("degenerate-mind", ctx([3]))).toEqual([
			{ kind: "grants-item", testKey: "talents:Frenzy" },
		]);
	});

	test("degenerate-mind: 4-7 Fearless, 8-10 From Beyond", async () => {
		expect(
			(await applyAfflictionProcedure("degenerate-mind", ctx([7])))[0]?.testKey,
		).toBe("talents:Fearless");
		expect(
			(await applyAfflictionProcedure("degenerate-mind", ctx([10])))[0]?.testKey,
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
		expect(out).toEqual([
			{ kind: "characteristic-modifier", testKey: "int", value: -8, label: "Mental Regressive" },
		]);
	});

	test("mental-regressive: 6-7 stores the delta that halves the value", async () => {
		// int 35, d10=6 -> floor(35/2) = 17 -> delta -18.
		const out = await applyAfflictionProcedure(
			"mental-regressive",
			ctx([6, 9, 9, 9], { int: 35 }),
		);
		expect(out).toEqual([
			{ kind: "characteristic-modifier", testKey: "int", value: -18, label: "Mental Regressive" },
		]);
	});

	test("mental-regressive: 10 stores the delta that lands on 5", async () => {
		const out = await applyAfflictionProcedure(
			"mental-regressive",
			ctx([10, 9, 9, 9], { int: 40 }),
		);
		expect(out).toEqual([
			{ kind: "characteristic-modifier", testKey: "int", value: -35, label: "Mental Regressive" },
		]);
	});

	test("a blank procedure yields no rows", async () => {
		expect(await applyAfflictionProcedure("", ctx([]))).toEqual([]);
		expect(await applyAfflictionProcedure(undefined, ctx([]))).toEqual([]);
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
