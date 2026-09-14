import { describe, expect, test } from "bun:test";
import { resolveAfflictionGrants, resolveEffectValues } from "./afflictions";

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
