import { describe, expect, test } from "bun:test";
import { buildActorView } from "../model/build";
import { collectEffects, collectEffectModifiers, effectKinds } from "./index";

// The effect engine (epic kof0, phase 2) is the one walk every consumer uses.
// These tests pin the collector contract and the extension seam.

describe("effect engine (epic kof0)", () => {
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
						effects: [{ kind: "test-modifier", value: 5, condition: "charging" }],
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
		expect(hits[0]?.spec.read?.(hits[0].item, hits[0].effect, { channel: "derived" })).toBe(7);
	});

	test("collectEffectModifiers maps the modifier-producing hits", () => {
		const view = buildActorView({
			items: [
				{
					type: "talent",
					name: "Sure Hand",
					system: { effects: [{ kind: "test-modifier", value: 5, label: "Sure Hand" }] },
				},
			],
		});
		const mods = collectEffectModifiers(view, { channel: "test" });
		expect(mods).toHaveLength(1);
		expect(mods[0]?.id).toBe("talent:Sure Hand:any:Sure Hand:any");
		expect(mods[0]?.value).toBe(5);
	});
});
