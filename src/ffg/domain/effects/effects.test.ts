import { describe, expect, test, afterEach } from "bun:test";
import { buildActorView } from "../model/build";
import { collectEffects, collectEffectModifiers, effectKinds } from "./index";
import { mergeModifiers } from "../../application/funnel";

// The effect engine (epic kof0, phase 2) is the one walk every consumer uses.
// These tests pin the collector contract and the extension seam.

describe("effect engine (epic kof0)", () => {
	// bun test runs every file in ONE process: a kind registered here would
	// reach the effect-editor-choices sweeps in effect-actions.test.ts when the
	// file walk runs this file first (the order that broke CI). Unregister
	// after every test, so the registry stays exactly what specs.ts shipped.
	afterEach(() => {
		effectKinds.unregister("test:module-bonus");
	});

	test("the core kinds are registered once", () => {
		const kinds = effectKinds.kinds();
		for (const kind of [
			"test-modifier",
			"attack-modifier",
			"characteristic-modifier",
			"damage-flat",
			"critical-damage",
			"tb-multiplier",
			"damage-reduction",
			"tearing",
			"toxic",
			"blast",
			"wounds-max",
			"sorcery-rank",
			"grants-item",
			"corruption",
		]) {
			expect(kinds, kind).toContain(kind);
		}
	});

	test("collects only effects whose kind feeds the queried channel", () => {
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Mixed",
					system: {
						effects: [
							{ kind: "test-modifier", value: 5 },
							{ kind: "wounds-max", value: 1 },
						],
					},
				},
			],
		});
		expect(collectEffects(view, { channel: "test" })).toHaveLength(1);
		expect(collectEffects(view, { channel: "derived" })).toHaveLength(1);
		expect(collectEffects(view, { channel: "damage" })).toHaveLength(0);
	});

	test("respects liveness: stowed gear does not contribute", () => {
		const gear = (equipState: string) => ({
			type: "gear",
			name: "Balm",
			system: { equipState, effects: [{ kind: "wounds-max", value: 2 }] },
		});
		expect(
			collectEffects(buildActorView({ items: [gear("carried")] }), {
				channel: "derived",
			}),
		).toHaveLength(1);
		expect(
			collectEffects(buildActorView({ items: [gear("stowed")] }), {
				channel: "derived",
			}),
		).toHaveLength(0);
	});

	test("a missing kind is ignored, and the schema default is test-modifier", () => {
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Default",
					system: { effects: [{ value: 5 }] }, // no kind -> test-modifier
				},
				{
					type: "talent",
					name: "Unknown",
					system: { effects: [{ kind: "not-a-kind", value: 5 }] },
				},
			],
		});
		const hits = collectEffects(view, { channel: "test" });
		expect(hits).toHaveLength(1);
		expect(hits[0]?.item.name).toBe("Default");
	});

	test("ignoreGuards collects guarded rows for the condition toggles", () => {
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Guarded",
					system: {
						effects: [
							{ kind: "test-modifier", value: 5, condition: "charging" },
						],
					},
				},
			],
		});
		expect(collectEffects(view, { channel: "test" })).toHaveLength(0);
		expect(
			collectEffects(view, { channel: "test", flags: { charging: true } }),
		).toHaveLength(1);
		expect(
			collectEffects(view, { channel: "test", ignoreGuards: true }),
		).toHaveLength(1);
	});

	test("the extension seam: a module can register a new kind", () => {
		effectKinds.register({
			kind: "test:module-bonus",
			channels: ["derived"],
			read: () => 7,
		});
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Homebrew",
					system: { effects: [{ kind: "test:module-bonus" }] },
				},
			],
		});
		const hits = collectEffects(view, { channel: "derived" });
		expect(hits).toHaveLength(1);
		expect(
			hits[0]?.spec.read?.(hits[0].item, hits[0].effect, {
				channel: "derived",
			}),
		).toBe(7);
	});

	test("collectEffectModifiers maps the modifier-producing hits", () => {
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Sure Hand",
					system: {
						effects: [{ kind: "test-modifier", value: 5, label: "Sure Hand" }],
					},
				},
			],
		});
		const mods = collectEffectModifiers(view, { channel: "test" });
		expect(mods).toHaveLength(1);
		expect(mods[0]?.id).toBe("talent:Sure Hand:any:Sure Hand:any");
		expect(mods[0]?.value).toBe(5);
	});

	// Bead 2040: the id keys on the item's own id (name fallback), so two
	// DIFFERENT documents sharing a name no longer collapse under
	// mergeModifiers' first-wins dedupe.
	test("bead 2040: two same-named items both contribute (additive)", () => {
		const medikit = (id: string) => ({
			id,
			type: "talent",
			name: "Medikit",
			system: {
				effects: [{ kind: "test-modifier", value: 5, label: "Medikit" }],
			},
		});
		const view = buildActorView({ items: [medikit("a"), medikit("b")] });
		const mods = collectEffectModifiers(view, { channel: "test" });
		expect(mods).toHaveLength(2);
		expect(new Set(mods.map((m) => m.id)).size).toBe(2);
		expect(mods[0]?.id).toBe("talent:a:any:Medikit:any");
		expect(mods[1]?.id).toBe("talent:b:any:Medikit:any");
		// The funnel's merge keeps both and they sum.
		const merged = mergeModifiers([], mods);
		expect(merged).toHaveLength(2);
		expect(merged.reduce((sum, m) => sum + m.value, 0)).toBe(10);
	});

	test("bead 2040: one item's duplicate rows still dedupe", () => {
		const view = buildActorView({
			items: [
				{
					id: "one",
					type: "talent",
					name: "Medikit",
					system: {
						effects: [
							{ kind: "test-modifier", value: 5, label: "Medikit" },
							{ kind: "test-modifier", value: 5, label: "Medikit" },
						],
					},
				},
			],
		});
		const mods = collectEffectModifiers(view, { channel: "test" });
		expect(mods).toHaveLength(2);
		expect(mergeModifiers([], mods)).toHaveLength(1);
	});

	// Bead gojg: the trait-reduction id keys on the item's own id (name
	// fallback), matching the funnel/damage channels — two DIFFERENT trait
	// documents sharing a name both soak instead of collapsing under a
	// first-wins dedupe, while one trait's duplicate rows still dedupe.
	test("bead gojg: two same-named traits both soak (additive)", () => {
		const trait = (id: string) => ({
			id,
			type: "trait",
			name: "Unnatural Toughness",
			system: {
				effects: [
					{ kind: "damage-reduction", value: 2, label: "Unnatural Toughness" },
				],
			},
		});
		const view = buildActorView({ items: [trait("a"), trait("b")] });
		const mods = collectEffectModifiers(view, { channel: "target-soak" });
		expect(mods).toHaveLength(2);
		expect(new Set(mods.map((m) => m.id)).size).toBe(2);
		expect(mods[0]?.id).toBe(
			"trait-reduction:a:Unnatural Toughness",
		);
		expect(mods[1]?.id).toBe(
			"trait-reduction:b:Unnatural Toughness",
			);
	});
});
