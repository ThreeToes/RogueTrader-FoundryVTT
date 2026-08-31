import { describe, expect, test } from "bun:test";
import {
	breakdown,
	collectTestModifiers,
	mergeModifiers,
	testContributors,
} from "./funnel";

describe("mergeModifiers", () => {
	test("deduplicates by id, first wins", () => {
		const a = [
			{
				id: "aim",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 10,
			},
		];
		const b = [
			{
				id: "aim",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 20,
			},
			{
				id: "wound",
				source: { type: "effect" as const, label: "e" },
				label: "Wound",
				value: -10,
			},
		];
		const merged = mergeModifiers(a, b);
		expect(merged).toHaveLength(2);
		expect(merged[0].value).toBe(10);
	});
});

describe("breakdown", () => {
	test("produces ordered label/value pairs", () => {
		const rows = breakdown([
			{
				id: "a",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 10,
			},
			{
				id: "b",
				source: { type: "effect" as const, label: "e" },
				label: "Wound",
				value: -10,
			},
		]);
		expect(rows).toEqual([
			{ label: "Aim", value: 10 },
			{ label: "Wound", value: -10 },
		]);
	});
});

describe("contributor registry", () => {
	test("register + run, malformed returns ignored", () => {
		testContributors.register("test-only", () => null);
		testContributors.register("test-only", () => [
			{
				id: "custom",
				source: { type: "talent" as const, label: "t" },
				label: "Custom",
				value: 5,
			},
		]);
		const mods = testContributors.run(
			{},
			{ kind: "characteristic", key: "ws" },
		);
		expect(mods).toHaveLength(1);
		expect(mods[0].id).toBe("custom");
	});

	test("extras take precedence over contributors by id", () => {
		const mods = collectTestModifiers(
			{},
			{ kind: "characteristic", key: "ws" },
			[
				{
					id: "custom",
					source: { type: "macro" as const, label: "m" },
					label: "Override",
					value: 30,
				},
			],
		);
		const custom = mods.find((m) => m.id === "custom");
		expect(custom?.value).toBe(30);
		expect(custom?.label).toBe("Override");
	});
});

describe("weapon-quality contributor", () => {
	test("accurate applies +10 on aimed attack tests only", () => {
		const aimed = collectTestModifiers(
			{},
			{
				kind: "attack",
				key: "bs",
				weapon: { type: "ranged-weapon", special: ["accurate"] },
				aimed: true,
			},
		);
		expect(aimed.find((m) => m.id === "quality:accurate")?.value).toBe(10);

		const plain = collectTestModifiers(
			{},
			{
				kind: "attack",
				key: "bs",
				weapon: { type: "ranged-weapon", special: ["accurate"] },
			},
		);
		expect(plain.find((m) => m.id === "quality:accurate")).toBeUndefined();
	});

	test("non-attack tests get no quality modifiers", () => {
		const mods = collectTestModifiers(
			{},
			{
				kind: "characteristic",
				key: "bs",
				weapon: { type: "ranged-weapon", special: ["accurate"] },
				aimed: true,
			},
		);
		expect(mods.find((m) => m.id === "quality:accurate")).toBeUndefined();
	});
});

describe("effect contributor", () => {
	test("system.testModifier changes become modifiers", () => {
		const actor = {
			appliedEffects: [
				{
					id: "fx1",
					name: "Inspired",
					changes: [
						{ key: "system.testModifier", value: 20 },
						{ key: "something.else", value: 999 },
					],
				},
			],
		};
		const mods = collectTestModifiers(actor, {
			kind: "characteristic",
			key: "fel",
		});
		const fx = mods.find((m) => m.id === "effect:fx1");
		expect(fx?.value).toBe(20);
		expect(fx?.source.type).toBe("effect");
	});
});

describe("talent contributor", () => {
	const talentActor = {
		items: [
			{
				type: "talent",
				system: {
					effects: [
						{ testKey: "", value: 5, label: "Sure Hand" },
						{ testKey: "bs", value: 10, label: "Deadeye Shooter" },
						{ testKey: "bs", value: 0, label: "zero ignored" },
					],
				},
			},
			{ type: "gear", system: {} },
		],
	};

	test("wildcard effect applies to every test kind", () => {
		const mods = collectTestModifiers(talentActor, {
			kind: "characteristic",
			key: "fel",
		});
		const t = mods.find((m) => m.id === "talent:any:Sure Hand");
		expect(t?.value).toBe(5);
		expect(
			mods.find((m) => m.id === "talent:any:zero ignored"),
		).toBeUndefined();
	});

	test("keyed effect only applies to matching tests", () => {
		const bs = collectTestModifiers(talentActor, { kind: "attack", key: "bs" });
		expect(bs.find((m) => m.id === "talent:bs:Deadeye Shooter")?.value).toBe(
			10,
		);
		const ws = collectTestModifiers(talentActor, { kind: "attack", key: "ws" });
		expect(
			ws.find((m) => m.id === "talent:bs:Deadeye Shooter"),
		).toBeUndefined();
		expect(ws.find((m) => m.id === "talent:any:Sure Hand")?.value).toBe(5);
	});

	test("non-talent items are ignored", () => {
		const mods = collectTestModifiers(
			{
				items: [
					{ type: "gear", system: { effects: [{ testKey: "", value: 99 }] } },
				],
			},
			{ kind: "characteristic", key: "ws" },
		);
		expect(mods.filter((m) => m.id.startsWith("talent:"))).toHaveLength(0);
	});
});
