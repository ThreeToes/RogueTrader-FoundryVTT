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
		const t = mods.find((m) => m.id === "talent:any:Sure Hand:any");
		expect(t?.value).toBe(5);
		expect(
			mods.find((m) => m.id === "talent:any:zero ignored:any"),
		).toBeUndefined();
	});

	test("keyed effect only applies to matching tests", () => {
		const bs = collectTestModifiers(talentActor, { kind: "attack", key: "bs" });
		expect(bs.find((m) => m.id === "talent:bs:Deadeye Shooter:any")?.value).toBe(
			10,
		);
		const ws = collectTestModifiers(talentActor, { kind: "attack", key: "ws" });
		expect(
			ws.find((m) => m.id === "talent:bs:Deadeye Shooter:any"),
		).toBeUndefined();
		expect(ws.find((m) => m.id === "talent:any:Sure Hand:any")?.value).toBe(5);
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

	// Guarded effects (bead czx): a condition field gates the effect on a
	// TestModifierContext flag, matching the talentConditions registry.
	const guardedActor = {
		items: [
			{
				type: "talent",
				system: {
					effects: [
						{ testKey: "ws", value: 20, label: "Berserk Charge", condition: "charging" },
					],
				},
			},
		],
	};

	test("guarded effect skipped when the context flag is unset", () => {
		const mods = collectTestModifiers(guardedActor, {
			kind: "attack",
			key: "ws",
		});
		expect(mods.find((m) => m.label === "Berserk Charge")).toBeUndefined();
	});

	test("guarded effect applies with its condition when the flag is set", () => {
		const mods = collectTestModifiers(guardedActor, {
			kind: "attack",
			key: "ws",
			flags: { charging: true },
		});
		const mod = mods.find((m) => m.label === "Berserk Charge");
		expect(mod?.value).toBe(20);
		expect(mod?.condition).toBe("charging");
	});

	test("guarded effect applies only to matching tests", () => {
		const mods = collectTestModifiers(guardedActor, {
			kind: "attack",
			key: "bs",
			flags: { charging: true },
		});
		expect(mods.find((m) => m.label === "Berserk Charge")).toBeUndefined();
	});

	// Attack-modifier kind (bead fjw/x0v): talents like Berserk Charge modify
	// the attack roll only - never plain characteristic/skill tests.
	const attackModifierActor = {
		items: [
			{
				type: "talent",
				system: {
					effects: [
						{
							kind: "attack-modifier",
							testKey: "ws",
							value: 20,
							label: "Berserk Charge",
							condition: "charging",
						},
					],
				},
			},
		],
	};

	test("attack-modifier applies to attack tests when the flag is set", () => {
		const mods = collectTestModifiers(attackModifierActor, {
			kind: "attack",
			key: "ws",
			flags: { charging: true },
		});
		const mod = mods.find((m) => m.label === "Berserk Charge");
		expect(mod?.value).toBe(20);
		expect(mod?.id).toBe("talent:attack:Berserk Charge:charging");
	});

	test("attack-modifier never applies to non-attack tests", () => {
		const mods = collectTestModifiers(attackModifierActor, {
			kind: "characteristic",
			key: "ws",
			flags: { charging: true },
		});
		expect(mods.find((m) => m.label === "Berserk Charge")).toBeUndefined();
	});

	describe("attack-context contributor (bead hyv)", () => {
		test("semi-auto burst adds +10, full auto +20 on attack tests", () => {
			const burst = collectTestModifiers(
				{},
				{ kind: "attack", key: "bs", fireMode: "burst" },
			);
			expect(
				burst.find((m) => m.id === "attack:fire-mode:burst")?.value,
			).toBe(10);
			const full = collectTestModifiers(
				{},
				{ kind: "attack", key: "bs", fireMode: "full" },
			);
			expect(
				full.find((m) => m.id === "attack:fire-mode:full")?.value,
			).toBe(20);
		});

		test("fire-mode modifiers never apply to non-attack tests", () => {
			const mods = collectTestModifiers(
				{},
				{ kind: "characteristic", key: "bs", fireMode: "full" },
			);
			expect(
				mods.find((m) => m.id.startsWith("attack:fire-mode")),
			).toBeUndefined();
		});
	});
});