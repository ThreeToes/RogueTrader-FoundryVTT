/**
 * Core effect-kind specs (epic kof0, phase 2).
 *
 * Every kind the system ships is registered here ONCE with its channel, key
 * grammar, guard handling and how it becomes a Modifier or a typed payload.
 * The consumers (funnel, damage pipeline, target soak, roll mechanics, derived
 * values, acquisition) call `collectEffects` and map the hits; none of them
 * walks items or parses guards itself.
 *
 * Adding an effect kind = one `effectKinds.register(...)` here, with the
 * editor label carried on the spec's `labelKey` (bead ypbx) — the sheet layer
 * derives its dropdown from the registry, so no second edit is needed.
 */

import type { Modifier } from "../../../rules-engine/modifier";
import type { EffectData } from "../model/effect";
import type { ItemView } from "../model/actor";
import { effectKinds } from "./registry";
import type { EffectContext } from "./types";

// ---------------------------------------------------------------------------
// Shared helpers (id shape, source label, key grammar, guards)
// ---------------------------------------------------------------------------

/** Item type -> the breakdown source label. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
	talent: "SOURCE.FROM_TALENTS",
	trait: "SOURCE.FROM_TRAITS",
	mutation: "SOURCE.FROM_MUTATIONS",
	madnessentry: "SOURCE.FROM_AFFLICTIONS",
	armour: "SOURCE.FROM_ARMOUR",
	gear: "SOURCE.FROM_GEAR",
	"melee-weapon": "SOURCE.FROM_WEAPONS",
	"ranged-weapon": "SOURCE.FROM_WEAPONS",
};

/** The Modifier source for an item (talents are their own source type). */
function sourceFor(item: ItemView): Modifier["source"] {
	return {
		type: item.type === "talent" ? "talent" : "item",
		label: SOURCE_LABELS[item.type] ?? "SOURCE.FROM_GEAR",
	};
}

/** Non-zero finite value, or null (zero/invalid rows never contribute). */
function numericValue(effect: EffectData): number | null {
	const value = Number(effect.value);
	return Number.isFinite(value) && value !== 0 ? value : null;
}

/** A guarded effect only applies when its condition flag is set. */
function guardPasses(effect: EffectData, ctx: EffectContext): boolean {
	if (ctx.ignoreGuards) return true;
	const condition = effect.condition;
	if (!condition) return true;
	return ctx.flags?.[condition] === true;
}

/**
 * Whether the effect's key targets the test. Characteristic changes match only
 * their own characteristic; "skill:<name>" keys match the SKILL test's item
 * name (bead r1k) so "Medikit: +20 Medicae" never hits every Int test; empty
 * keys are wildcards.
 */
function keyMatches(
	effect: EffectData,
	ctx: EffectContext,
	mode: "characteristic" | "test",
): boolean {
	const key = effect.testKey;
	if (mode === "characteristic") return Boolean(key) && key === ctx.testKey;
	if (key?.startsWith("skill:")) {
		return (
			ctx.skillName?.toLowerCase() === key.slice("skill:".length).toLowerCase()
		);
	}
	return key === "" || key === undefined || key === ctx.testKey;
}

/** The funnel modifier id: the owning item's id is part of it so two
 * different items with the same (label, key, condition) shape stay additive
 * even when they share a name (mergeModifiers dedupes first-wins; bead 2040);
 * hand-built views with no id fall back to the name, so a single item's
 * duplicate rows still collide and dedupe. */
function funnelId(item: ItemView, effect: EffectData, keyPart: string): string {
	const prefix = item.type === "talent" ? "talent" : `item:${item.type}`;
	return `${prefix}:${item.id || item.name}:${keyPart}:${effect.label ?? ""}:${effect.condition || "any"}`;
}

/** The shared funnel modifier builder for the three test kinds. Exported for
 * the shared initiative-row collector (bead zl6e), which reuses the domain id
 * source/label/id shape so its rows merge/dedupe like every other funnel
 * row. */
export function funnelModifier(
	item: ItemView,
	effect: EffectData,
	keyPart: string,
): Modifier {
	return {
		id: funnelId(item, effect, keyPart),
		source: sourceFor(item),
		// Unlabelled effects fall back to the owning item's name, never a slug.
		label: effect.label || item.name || "",
		value: Number(effect.value),
		...(effect.condition ? { condition: effect.condition } : {}),
	};
}

// ---------------------------------------------------------------------------
// Test channel (the funnel)
// ---------------------------------------------------------------------------

/** "test-modifier" (and the schema default): any test, keyed or wildcard. */
effectKinds.register({
	kind: "test-modifier",
	labelKey: "EFFECT_KIND.TEST_MODIFIER",
	channels: ["test"],
	applies: (effect, ctx) =>
		guardPasses(effect, ctx) &&
		numericValue(effect) !== null &&
		keyMatches(effect, ctx, "test"),
	toModifier: (item, effect) =>
		funnelModifier(item, effect, effect.testKey || "any"),
});

/** "attack-modifier": attack tests only (Berserk Charge, Gunslinger, …). */
effectKinds.register({
	kind: "attack-modifier",
	labelKey: "EFFECT_KIND.ATTACK_MODIFIER",
	channels: ["test"],
	applies: (effect, ctx) =>
		ctx.testKind === "attack" &&
		guardPasses(effect, ctx) &&
		numericValue(effect) !== null &&
		keyMatches(effect, ctx, "test"),
	toModifier: (item, effect) => funnelModifier(item, effect, "attack"),
});

/** "characteristic-modifier": characteristic-keyed, any test kind. */
effectKinds.register({
	kind: "characteristic-modifier",
	labelKey: "EFFECT_KIND.CHARACTERISTIC_MODIFIER",
	channels: ["test"],
	applies: (effect, ctx) =>
		guardPasses(effect, ctx) &&
		numericValue(effect) !== null &&
		keyMatches(effect, ctx, "characteristic"),
	toModifier: (item, effect) =>
		funnelModifier(item, effect, `char:${effect.testKey}`),
});

// ---------------------------------------------------------------------------
// Damage channel (flat damage / critical damage)
// ---------------------------------------------------------------------------

/** "damage-flat"/"critical-damage": melee|ranged|any, guard-aware. */
function damageApplies(effect: EffectData, ctx: EffectContext): boolean {
	if (!guardPasses(effect, ctx)) return false;
	if (numericValue(effect) === null) return false;
	const key = effect.testKey ?? "";
	const bucket =
		key === ""
			? "any"
			: key === "melee"
				? "melee-weapon"
				: key === "ranged"
					? "ranged-weapon"
					: key;
	return bucket === "any" || bucket === ctx.attackType;
}

function damageModifier(
	item: ItemView,
	effect: EffectData,
	kind: string,
): Modifier {
	const isTalent = item.type === "talent";
	return {
		// Bead 2040: the item's own id (name as fallback) keeps two distinct
		// same-named documents additive while one item's duplicates dedupe.
		id: `${isTalent ? "talent-damage" : "weapon-damage"}:${item.id || item.name}:${kind}:${effect.label ?? ""}:${effect.condition || "any"}`,
		source: {
			type: isTalent ? "talent" : "item",
			label: isTalent ? "SOURCE.FROM_TALENTS" : "SOURCE.FROM_WEAPONS",
		},
		label: effect.label || item.name || "",
		value: Number(effect.value),
		...(effect.condition ? { condition: effect.condition } : {}),
	};
}

effectKinds.register({
	kind: "damage-flat",
	labelKey: "EFFECT_KIND.DAMAGE_FLAT",
	channels: ["damage"],
	applies: damageApplies,
	toModifier: (item, effect) => damageModifier(item, effect, "damage-flat"),
});

effectKinds.register({
	kind: "critical-damage",
	labelKey: "EFFECT_KIND.CRITICAL_DAMAGE",
	channels: ["damage"],
	applies: damageApplies,
	toModifier: (item, effect) => damageModifier(item, effect, "critical-damage"),
});

// ---------------------------------------------------------------------------
// Target-soak channel (target-side trait machinery, bead zyv1)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "tb-multiplier",
	labelKey: "EFFECT_KIND.TB_MULTIPLIER",
	channels: ["target-soak"],
	applies: (effect) => Number(effect.value) > 0,
	read: (_item, effect) => Number(effect.value),
});

effectKinds.register({
	kind: "damage-reduction",
	labelKey: "EFFECT_KIND.DAMAGE_REDUCTION",
	channels: ["target-soak"],
	applies: (effect) => Number(effect.value) > 0,
	toModifier: (item, effect) => ({
		// The item id rides on the id (name fallback, 2040's shape) so
		// same-named rows on different traits stay additive (funnel dedupe
		// lesson).
		id: `trait-reduction:${item.id || item.name}:${effect.label ?? ""}`,
		source: { type: "item", label: "SOURCE.FROM_TRAITS" },
		label: effect.label || item.name || "",
		value: Number(effect.value),
	}),
});

// ---------------------------------------------------------------------------
// Roll-mechanic channel (tearing / toxic / blast, bead gci0)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "tearing",
	labelKey: "EFFECT_KIND.TEARING",
	channels: ["roll-mechanic"],
	read: () => true,
});

effectKinds.register({
	kind: "toxic",
	labelKey: "EFFECT_KIND.TOXIC",
	channels: ["roll-mechanic"],
	read: () => true,
});

// ---------------------------------------------------------------------------
// Weapon-profile channel (attached weapon mods, bead huaf/ujtg)
//
// Mod rows on a weapon-modification item that change the FIRE PROFILE of the
// weapon they are attached to. They are NOT collected at actor level (the
// carrying item type is on no liveness table) — the attack profile fold
// (ffg/domain/model/attack.ts foldWeaponMods) reads the attached mod's rows
// directly, so a mono installation fights correctly (+2 Pen, Not Primitive)
// without touching the damage pipeline. Registration keeps the kinds in the
// ONE effect vocabulary (the editor dropdown resolves its labels here).
// ---------------------------------------------------------------------------

/** "pen-flat": flat Penetration added to the attached weapon's profile. */
effectKinds.register({
	kind: "pen-flat",
	labelKey: "EFFECT_KIND.PEN_FLAT",
	channels: ["weapon-profile"],
	applies: (effect) => Number.isFinite(Number(effect.value)),
	read: (_item, effect) => Number(effect.value),
});

/** "primitive-clear": the mod cancels the weapon's Primitive quality (Mono). */
effectKinds.register({
	kind: "primitive-clear",
	labelKey: "EFFECT_KIND.PRIMITIVE_CLEAR",
	channels: ["weapon-profile"],
	read: () => true,
});

effectKinds.register({
	kind: "blast",
	labelKey: "EFFECT_KIND.BLAST",
	channels: ["roll-mechanic"],
	applies: (effect) => Number.isFinite(Number(effect.value)),
	read: (_item, effect) => Number(effect.value),
});

// ---------------------------------------------------------------------------
// Derived channel (wounds-max, skill-rank, sorcery-rank)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "wounds-max",
	labelKey: "EFFECT_KIND.WOUNDS_MAX",
	channels: ["derived"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 1);
		return Number.isFinite(value) && value !== 0 ? value : null;
	},
});

effectKinds.register({
	kind: "skill-rank",
	labelKey: "EFFECT_KIND.SKILL_RANK",
	channels: ["derived"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 0);
		return Number.isFinite(value) && value !== 0 ? value : null;
	},
});

effectKinds.register({
	kind: "sorcery-rank",
	labelKey: "EFFECT_KIND.SORCERY_RANK",
	channels: ["derived"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 0);
		return Number.isFinite(value) && value > 0 ? value : null;
	},
});

// ---------------------------------------------------------------------------
// Acquisition channel (grants, corruption, techniques)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "grants-item",
	labelKey: "EFFECT_KIND.GRANTS_ITEM",
	channels: ["acquisition"],
	read: (_item, effect) => ({
		target: (effect.testKey ?? "").trim(),
		benefit: (effect.label ?? "").trim(),
	}),
});

effectKinds.register({
	kind: "corruption",
	labelKey: "EFFECT_KIND.CORRUPTION",
	channels: ["acquisition"],
	read: (_item, effect) => {
		const dice = (effect.dice ?? "").trim();
		if (dice) return dice;
		const value = Number(effect.value);
		return Number.isFinite(value) && value !== 0 ? String(value) : null;
	},
});

effectKinds.register({
	kind: "grants-technique",
	labelKey: "EFFECT_KIND.GRANTS_TECHNIQUE",
	channels: ["acquisition"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 1);
		return Number.isFinite(value) && value > 0 ? value : 1;
	},
});
