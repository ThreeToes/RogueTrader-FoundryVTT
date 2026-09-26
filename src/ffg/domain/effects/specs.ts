/**
 * Core effect-kind specs (epic kof0, phase 2).
 *
 * Every kind the system ships is registered here ONCE with its channel, key
 * grammar, guard handling and how it becomes a Modifier or a typed payload.
 * The consumers (funnel, damage pipeline, target soak, roll mechanics, derived
 * values, acquisition) call `collectEffects` and map the hits; none of them
 * walks items or parses guards itself.
 *
 * Adding an effect kind = one `effectKinds.register(...)` here.
 */

import type { Modifier } from "../../../rules-engine/src/modifier";
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
			ctx.skillName?.toLowerCase() ===
			key.slice("skill:".length).toLowerCase()
		);
	}
	return key === "" || key === undefined || key === ctx.testKey;
}

/** The funnel modifier id: the owning item's name is part of it so two
 * different items with the same (label, key, condition) shape stay additive. */
function funnelId(item: ItemView, effect: EffectData, keyPart: string): string {
	const prefix = item.type === "talent" ? "talent" : `item:${item.type}`;
	return `${prefix}:${item.name}:${keyPart}:${effect.label ?? ""}:${effect.condition || "any"}`;
}

/** The shared funnel modifier builder for the three test kinds. */
function funnelModifier(
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
		id: `${isTalent ? "talent-damage" : "weapon-damage"}:${item.name}:${kind}:${effect.label ?? ""}:${effect.condition || "any"}`,
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
	channels: ["damage"],
	applies: damageApplies,
	toModifier: (item, effect) => damageModifier(item, effect, "damage-flat"),
});

effectKinds.register({
	kind: "critical-damage",
	channels: ["damage"],
	applies: damageApplies,
	toModifier: (item, effect) => damageModifier(item, effect, "critical-damage"),
});

// ---------------------------------------------------------------------------
// Target-soak channel (target-side trait machinery, bead zyv1)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "tb-multiplier",
	channels: ["target-soak"],
	applies: (effect) => Number(effect.value) > 0,
	read: (_item, effect) => Number(effect.value),
});

effectKinds.register({
	kind: "damage-reduction",
	channels: ["target-soak"],
	applies: (effect) => Number(effect.value) > 0,
	toModifier: (item, effect) => ({
		// The item name rides on the id so same-shaped rows on different traits
		// stay additive (funnel dedupe lesson).
		id: `trait-reduction:${item.name ?? ""}:${effect.label ?? ""}`,
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
	channels: ["roll-mechanic"],
	read: () => true,
});

effectKinds.register({
	kind: "toxic",
	channels: ["roll-mechanic"],
	read: () => true,
});

effectKinds.register({
	kind: "blast",
	channels: ["roll-mechanic"],
	applies: (effect) => Number.isFinite(Number(effect.value)),
	read: (_item, effect) => Number(effect.value),
});

// ---------------------------------------------------------------------------
// Derived channel (wounds-max, skill-rank, sorcery-rank)
// ---------------------------------------------------------------------------

effectKinds.register({
	kind: "wounds-max",
	channels: ["derived"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 1);
		return Number.isFinite(value) && value !== 0 ? value : null;
	},
});

effectKinds.register({
	kind: "skill-rank",
	channels: ["derived"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 0);
		return Number.isFinite(value) && value !== 0 ? value : null;
	},
});

effectKinds.register({
	kind: "sorcery-rank",
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
	channels: ["acquisition"],
	read: (_item, effect) => ({
		target: (effect.testKey ?? "").trim(),
		benefit: (effect.label ?? "").trim(),
	}),
});

effectKinds.register({
	kind: "corruption",
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
	channels: ["acquisition"],
	read: (_item, effect) => {
		const value = Number(effect.value ?? 1);
		return Number.isFinite(value) && value > 0 ? value : 1;
	},
});
