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

	// Roll-dialog round-trip (bead bpd follow-up): the dialog echoes funnel
	// contributors back with their original ids; postTest re-collects with the
	// dialog result as extras — same id must collapse, not double-count.
	test("dialog-echoed funnel contributors dedupe, not double-count", () => {
		const actor = {
			items: [
				{
					type: "talent",
					system: {
						effects: [{ testKey: "", value: 5, label: "Sure Hand" }],
					},
				},
			],
		};
		const funnelRun = collectTestModifiers(actor, { kind: "skill", key: "fel" });
		// Dialog returns the echoed contributor rows + a custom row.
		const dialogResult = [
			...funnelRun,
			{
				id: "custom:0",
				source: { type: "dialog" as const, label: "d" },
				label: "Custom",
				value: 10,
			},
		];
		const postDialog = collectTestModifiers(
			actor,
			{ kind: "skill", key: "fel" },
			dialogResult,
		);
		const sureHand = postDialog.filter((m) => m.label === "Sure Hand");
		expect(sureHand).toHaveLength(1);
		expect(postDialog.reduce((sum, m) => sum + m.value, 0)).toBe(15);
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
		const t = mods.find((m) => m.id === "talent::any:Sure Hand:any");
		expect(t?.value).toBe(5);
		expect(
			mods.find((m) => m.id === "talent::any:zero ignored:any"),
		).toBeUndefined();
	});

	test("keyed effect only applies to matching tests", () => {
		const bs = collectTestModifiers(talentActor, { kind: "attack", key: "bs" });
		expect(bs.find((m) => m.id === "talent::bs:Deadeye Shooter:any")?.value).toBe(
			10,
		);
		const ws = collectTestModifiers(talentActor, { kind: "attack", key: "ws" });
		expect(
			ws.find((m) => m.id === "talent::bs:Deadeye Shooter:any"),
		).toBeUndefined();
		expect(ws.find((m) => m.id === "talent::any:Sure Hand:any")?.value).toBe(5);
	});

	// Bug report (owner, 2026-09-05): two talents with identical (empty)
	// labels/testKeys collapsed into one modifier because the id omitted the
	// owning item's name. Every distinct talent's modifier is additive.
	test("two talents with the same effect shape are both additive", () => {
		const twoTalents = {
			items: [
				{ name: "Sure Strike", type: "talent", system: { effects: [{ testKey: "", value: 5 }] } },
				{ name: "Deadly Aim", type: "talent", system: { effects: [{ testKey: "", value: 10 }] } },
			],
		};
		const mods = collectTestModifiers(twoTalents, {
			kind: "characteristic",
			key: "ws",
		});
		expect(mods.find((m) => m.id === "talent:Sure Strike:any::any")?.value).toBe(5);
		expect(mods.find((m) => m.id === "talent:Deadly Aim:any::any")?.value).toBe(10);
		expect(
			mods
				.filter((m) => m.id.startsWith("talent:"))
				.reduce((sum, m) => sum + m.value, 0),
		).toBe(15);
	});

	test("the same talent's re-collected row dedupes across the dialog round-trip", () => {
		const first = collectTestModifiers(talentActor, { kind: "characteristic", key: "fel" });
		const second = collectTestModifiers(talentActor, { kind: "characteristic", key: "fel" }, first);
		expect(second.filter((m) => m.id.startsWith("talent")).length).toBe(
			first.filter((m) => m.id.startsWith("talent")).length,
		);
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

	// Bead yb6: gear-family effects feed the funnel only when the item is
	// equipped (carried gear/weapons, worn armour). Items without an equip
	// state (raw data in tests) count as stowed.
	describe("skill-keyed item effects (bead r1k)", () => {
		const medikit = {
			type: "gear",
			system: {
				equipState: "carried",
				effects: [
					{ kind: "test-modifier", testKey: "skill:medicae", value: 20, label: "Medikit" },
				],
			},
		};
		const collectSkill = (skillName: string | undefined) =>
			collectTestModifiers(
				{ items: [medikit] },
				{ kind: "skill", key: "int", skillName },
			).filter((m) => m.label === "Medikit");

		test("skill-keyed effect applies only to the matching skill test", () => {
			expect(collectSkill("medicae")).toHaveLength(1);
		});

		test("other skill tests on the same characteristic do not match", () => {
			// Medicae is Int-based: a Logic test is also Int — no +20.
			expect(collectSkill("logic")).toHaveLength(0);
		});

		test("characteristic tests never match skill-keyed effects", () => {
			expect(collectSkill(undefined)).toHaveLength(0);
		});

		test("skill name matching is case-insensitive", () => {
			expect(collectSkill("Medicae")).toHaveLength(1);
		});
	});

	describe("weapon quality contributions (bead r1k, verified book pp115-117)", () => {
		const collectAttack = (special: string[], aimed = false) =>
			collectTestModifiers(
				{ items: [] },
				{ kind: "attack", key: "bs", weapon: { type: "ranged-weapon", special }, aimed },
			);

		test("accurate grants +10 only when aimed", () => {
			const aimed = collectAttack(["accurate"], true).filter((m) => m.label === "accurate");
			expect(aimed).toHaveLength(1);
			expect(aimed[0]?.value).toBe(10);
			expect(collectAttack(["accurate"], false).filter((m) => m.label === "accurate")).toHaveLength(0);
		});

		test("defensive imposes -10 on attack tests", () => {
			const mods = collectAttack(["defensive"]).filter((m) => m.label === "defensive");
			expect(mods).toHaveLength(1);
			expect(mods[0]?.value).toBe(-10);
		});
	});
	describe("gear-family item effects (bead yb6)", () => {
		const item = (type: string, equipState?: string, value = 5) => ({
			type,
			system: {
				...(equipState ? { equipState } : {}),
				effects: [{ testKey: "", value, label: "Item Effect" }],
			},
		});
		const collect = (items: unknown[]) =>
			collectTestModifiers(
				{ items },
				{ kind: "characteristic", key: "fel" },
				// Earlier tests register a global "test-only" contributor; the
				// label filter isolates this describe's item contributions.
			).filter((m) => m.label === "Item Effect");

		test("carried gear and ready weapons contribute", () => {
			const mods = collect([
				item("gear", "carried"),
				item("melee-weapon", "carried"),
				item("ranged-weapon", "carried"),
			]);
			expect(mods).toHaveLength(3);
			expect(mods.every((m) => m.id.startsWith("item:"))).toBe(true);
		});

		test("worn armour contributes, stowed armour does not", () => {
			expect(collect([item("armour", "worn")])).toHaveLength(1);
			expect(collect([item("armour", "stowed")])).toHaveLength(0);
		});

		test("stowed gear and unequipped items are ignored", () => {
			expect(collect([item("gear", "stowed")])).toHaveLength(0);
			expect(collect([item("gear")])).toHaveLength(0);
		});

		test("non-contributing item types are ignored even when carried", () => {
			expect(collect([item("madness", "carried")])).toHaveLength(0);
			expect(collect([item("skill", "carried")])).toHaveLength(0);
		});

		test("psychic powers contribute like talents (known items, bead sa6)", () => {
			expect(collect([item("psychicpower")])).toHaveLength(1);
			// ...regardless of equip state — powers are "known", not carried.
			expect(collect([item("psychicpower", "carried")])).toHaveLength(1);
		});

		test("source label names the item type for the breakdown", () => {
			const [gearMod] = collect([item("gear", "carried")]);
			expect(gearMod?.source).toEqual({
				type: "item",
				label: "SOURCE.FROM_GEAR",
			});
			const [weaponMod] = collect([item("ranged-weapon", "carried")]);
			expect(weaponMod?.source).toEqual({
				type: "item",
				label: "SOURCE.FROM_WEAPONS",
			});
		});
	});

	// Rulebook traits (bead zyv1): innate items — always live, no equip
	// state; test-side effect rows feed the funnel like talents do.
	describe("trait item effects (bead zyv1)", () => {
		const trait = (effects: unknown[]) => ({
			name: "Machine (6)",
			type: "trait",
			system: { effects },
		});
		const collect = (items: unknown[]) =>
			collectTestModifiers(
				{ items },
				{ kind: "attack", key: "ws" },
			).filter((m) => m.id.startsWith("item:trait") || m.label === "Trait Effect");

		test("unkeyed test-modifier rows contribute on any test kind", () => {
			const mods = collect([
				trait([{ kind: "test-modifier", testKey: "", value: -10, label: "Trait Effect" }]),
			]);
			expect(mods).toHaveLength(1);
			expect(mods[0].value).toBe(-10);
			expect(mods[0].source).toEqual({ type: "item", label: "SOURCE.FROM_TRAITS" });
		});

		test("attack-modifier rows apply only to attack tests", () => {
			const mods = collectTestModifiers(
				{ items: [trait([{ kind: "attack-modifier", testKey: "ws", value: 10, label: "Trait Effect" }])] },
				{ kind: "attack", key: "ws" },
			).filter((m) => m.label === "Trait Effect");
			expect(mods).toHaveLength(1);
			const nonAttack = collectTestModifiers(
				{ items: [trait([{ kind: "attack-modifier", testKey: "ws", value: 10, label: "Trait Effect" }])] },
				{ kind: "characteristic", key: "ws" },
			).filter((m) => m.label === "Trait Effect");
			expect(nonAttack).toHaveLength(0);
		});

		test("damage-side kinds never contribute test modifiers", () => {
			expect(collect([
				trait([{ kind: "tb-multiplier", value: 2, label: "Trait Effect" }]),
				trait([{ kind: "damage-reduction", value: 6, label: "Trait Effect" }]),
			])).toHaveLength(0);
		});
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
		expect(mod?.id).toBe("talent::attack:Berserk Charge:charging");
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