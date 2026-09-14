import { describe, expect, test } from "bun:test";
import {
	afflictionKey,
	indexAfflictionDefs,
	resolveAfflictionModifiers,
	resolveCharacteristicChanges,
	type AfflictionDef,
} from "./afflictions";

const defs: AfflictionDef[] = [
	{
		kind: "malignancy",
		name: "Skin Afflictions",
		text: "",
		effects: [
			{
				kind: "test-modifier",
				testKey: "skill:charm",
				value: -20,
				label: "Skin Afflictions",
			},
		],
	},
	{
		kind: "mutation",
		name: "Nightsider",
		text: "",
		effects: [
			{ kind: "test-modifier", value: -10, condition: "brightlight" },
		],
	},
	{
		// Damage kinds must NOT leak into the test funnel.
		kind: "mutation",
		name: "Venomous",
		text: "",
		effects: [{ kind: "toxic", value: 1 }],
	},
];
const ledger = [
	{ kind: "malignancy", name: "Skin Afflictions" },
	{ kind: "mutation", name: "Nightsider" },
	{ kind: "mutation", name: "Venomous" },
];

describe("resolveAfflictionModifiers (bead jy4o)", () => {
	test("skill-keyed effects match only the named skill test", () => {
		const hit = resolveAfflictionModifiers(ledger, defs, {
			kind: "skill",
			key: "fel",
			skillName: "Charm",
		});
		expect(hit.map((m) => [m.label, m.value])).toEqual([
			["Skin Afflictions", -20],
		]);
		const miss = resolveAfflictionModifiers(ledger, defs, {
			kind: "skill",
			key: "fel",
			skillName: "Intimidate",
		});
		expect(miss).toHaveLength(0);
	});

	test("guarded effects only apply when the context flag is set", () => {
		const off = resolveAfflictionModifiers(ledger, defs, {
			kind: "characteristic",
			key: "ws",
		});
		expect(off).toHaveLength(0);
		const on = resolveAfflictionModifiers(ledger, defs, {
			kind: "characteristic",
			key: "ws",
			flags: { brightlight: true },
		});
		expect(on.map((m) => m.value)).toEqual([-10]);
	});

	test("non-test effect kinds never reach the funnel", () => {
		const mods = resolveAfflictionModifiers(ledger, defs, {
			kind: "characteristic",
			key: "t",
		});
		expect(mods).toHaveLength(0);
	});

	test("unknown ledger entries contribute nothing", () => {
		expect(
			resolveAfflictionModifiers([{ kind: "disorder", name: "Phobia" }], defs, {
				kind: "characteristic",
				key: "wp",
			}),
		).toHaveLength(0);
	});

	test("ids are sourced by affliction so equal values stay additive", () => {
		const two: AfflictionDef[] = [
			{
				kind: "mutation",
				name: "A",
				text: "",
				effects: [{ kind: "test-modifier", testKey: "s", value: 10 }],
			},
			{
				kind: "mutation",
				name: "B",
				text: "",
				effects: [{ kind: "test-modifier", testKey: "s", value: 10 }],
			},
		];
		const mods = resolveAfflictionModifiers(
			[
				{ kind: "mutation", name: "A" },
				{ kind: "mutation", name: "B" },
			],
			two,
			{ kind: "characteristic", key: "s" },
		);
		expect(mods).toHaveLength(2);
		expect(new Set(mods.map((m) => m.id)).size).toBe(2);
	});

	test("indexAfflictionDefs keys by kind:name", () => {
		expect(
			indexAfflictionDefs(defs).get(
				afflictionKey("malignancy", "Skin Afflictions"),
			),
		).toBeDefined();
	});

	test("stored characteristic changes emit keyed to the characteristic", () => {
		// Rolled at acquisition and persisted; the funnel only reports them for
		// tests on the affected characteristic. Works even with no defs (the
		// value already lives on the ledger).
		const withDelta = [
			{
				kind: "malignancy",
				name: "Palsy",
				characteristics: [{ key: "ag", value: -6 }],
			},
		];
		expect(
			resolveAfflictionModifiers(withDelta, [], {
				kind: "characteristic",
				key: "ws",
			}),
		).toHaveLength(0);
		const ag = resolveAfflictionModifiers(withDelta, [], {
			kind: "skill",
			key: "ag",
			skillName: "Dodge",
		});
		expect(ag.map((m) => [m.label, m.value])).toEqual([["Palsy", -6]]);
	});
});

describe("resolveCharacteristicChanges (bead xu83)", () => {
	test("flat values pass through; dice are rolled once via the roller", async () => {
		const changes = await resolveCharacteristicChanges(
			[
				{ kind: "characteristic-modifier", testKey: "s", value: 10 },
				{ kind: "characteristic-modifier", testKey: "ag", dice: "2d10" },
				{ kind: "test-modifier", testKey: "skill:charm", value: -20 },
			],
			async (notation) => (notation === "2d10" ? 7 : 0),
		);
		expect(changes).toEqual([
			{ key: "s", value: 10 },
			{ key: "ag", value: 7 },
		]);
	});

	test("zero/blank changes are dropped", async () => {
		expect(
			await resolveCharacteristicChanges(
				[
					{ kind: "characteristic-modifier", testKey: "", value: 5 },
					{ kind: "characteristic-modifier", testKey: "t", value: 0 },
				],
				async () => 0,
			),
		).toEqual([]);
	});
});
