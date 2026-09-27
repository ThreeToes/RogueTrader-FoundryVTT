/**
 * Modifier funnel (hoisted from src/roguetrader/rules/funnel.ts, bead 8ycd):
 * the single collection point between a system's data and the rules engine.
 * Sources push `Modifier` values in; consumers (roll dialogs, chat cards)
 * receive an ordered breakdown and a total.
 *
 * The item-effect walk lives in the effect engine (domain/effects): this module
 * registers the contributors and runs them over an `ActorView`. New sources
 * never touch sheet or roll code.
 *
 * System-specific contributors (RT origin traits, RT fire-mode homebrew)
 * register themselves from the sibling system module — this file holds only
 * the machinery and the FFG-generic contributors, so it stays system-neutral
 * and Foundry-free (application layer, epic kof0).
 *
 * Built-in contributors:
 * - "effect": ActiveEffect changes keyed `system.testModifier` become additive
 *   modifiers (change value parsed as a number).
 * - "weapon-qualities": when a test carries a weapon, known qualities map to
 *   fixed contributions (data table below; values are remembered RT core
 *   rules, flagged for verification).
 */

import type { Modifier } from "../../rules-engine/modifier";
import type { ActorView } from "../domain/model/actor";
import type { TestKind } from "../domain/model/test";
import { collectEffects } from "../domain/effects";
import { HandlerRegistry } from "../domain/registry";

/** Test kinds that reach the funnel (re-exported from the domain model). */
export type { TestKind } from "../domain/model/test";

export interface TestModifierContext {
	/** What kind of test is being rolled. */
	kind: TestKind;
	/** Characteristic key (or test id) for display purposes. */
	key: string;
	/** The weapon item for attack tests, when applicable. */
	weapon?: { type: string; special?: string[] } | null;
	/** Attack context flags. */
	aimed?: boolean;
	fireMode?: "single" | "burst" | "full";
	/** Guarded-effect flags (talentConditions keys), e.g. { charging: true }. */
	flags?: Record<string, boolean>;
	/**
	 * Skill-item test name, lowercased (bead r1k): lets item effects key on
	 * SKILL tests ("skill:medicae") rather than the skill's underlying
	 * characteristic — "+20 to Medicae Tests" must not hit every Int test.
	 */
	skillName?: string;
}

export type TestContributor = (
	view: ActorView,
	context: TestModifierContext,
) => Modifier[];

const contributors = new HandlerRegistry<string, TestContributor>();

export const testContributors = {
	/** Register a contributor for a source type. Repeat adds to that type. */
	register(type: string, fn: TestContributor): void {
		contributors.on(type, fn);
	},
	/** Source types with at least one contributor (newest last). */
	types(): string[] {
		return contributors.keys();
	},
	/** Run every registered contributor; malformed results are ignored. */
	run(view: ActorView, context: TestModifierContext): Modifier[] {
		const out: Modifier[] = [];
		for (const fn of contributors.all()) {
			const mods = fn(view, context) ?? [];
			if (Array.isArray(mods)) out.push(...mods);
		}
		return out;
	},
};

/** Merge de-duplicating by modifier id (first registration wins). */
export function mergeModifiers(
	first: Modifier[],
	second: Modifier[],
): Modifier[] {
	const seen = new Map<string, Modifier>();
	for (const mod of [...first, ...second]) {
		if (!seen.has(mod.id)) seen.set(mod.id, mod);
	}
	return [...seen.values()];
}

/**
 * Collect modifiers for a test: caller-provided extras (dialog, macros) take
 * precedence by id, then every registered contributor runs.
 */
export function collectTestModifiers(
	view: ActorView,
	context: TestModifierContext,
	extra: Modifier[] = [],
): Modifier[] {
	return mergeModifiers(extra, testContributors.run(view, context));
}

/** Ordered {label, value} breakdown for chat cards. */
export function breakdown(
	modifiers: Modifier[],
): Array<{ label: string; value: number }> {
	return modifiers.map((mod) => ({ label: mod.label, value: mod.value }));
}

// ---------------------------------------------------------------------------
// Built-in contributor: weapon qualities -> fixed attack contributions.
// Data table (extensible); values are remembered RT core rules (VERIFY).
// ---------------------------------------------------------------------------
const QUALITY_CONTRIBUTIONS: Record<
	string,
	(context: TestModifierContext) => number | null
> = {
	// Accurate: VERIFIED book p115-116 (PDF p116): +10 to BS with an Aim
	// Action, in addition to the aiming bonus.
	accurate: (context) =>
		context.aimed && context.kind === "attack" ? 10 : null,
	// Defensive: VERIFIED book p115 (PDF p116): +15 to Parry but -10 when
	// used to make attacks. The attack penalty lives here.
	defensive: (context) => (context.kind === "attack" ? -10 : null),
};

testContributors.register("weapon-qualities", (_view, context) => {
	if (context.kind !== "attack" || !context.weapon) return [];
	const special = context.weapon.special ?? [];
	const mods: Modifier[] = [];
	for (const quality of special) {
		const compute = QUALITY_CONTRIBUTIONS[quality];
		if (!compute) continue;
		const value = compute(context);
		if (value === null || value === 0) continue;
		mods.push({
			id: `quality:${quality}`,
			source: { type: "item", label: "WEAPON.SPECIAL" },
			label: quality,
			value,
		});
	}
	return mods;
});

// ---------------------------------------------------------------------------
// Built-in contributor: ActiveEffect changes keyed `system.testModifier`.
// ---------------------------------------------------------------------------
testContributors.register("effect", (view) => {
	const mods: Modifier[] = [];
	for (const effect of view.appliedEffects) {
		for (const change of effect.changes) {
			if (change.key !== "system.testModifier") continue;
			const value = Number(change.value);
			if (!Number.isFinite(value) || value === 0) continue;
			mods.push({
				id: `effect:${effect.id || effect.name || "unnamed"}`,
				source: { type: "effect", label: effect.name ?? "Effect" },
				label: effect.name ?? "Effect",
				value,
			});
		}
	}
	return mods;
});

// ---------------------------------------------------------------------------
// Built-in contributor: owned item effects -> test modifiers. The walk itself
// lives in the effect engine (domain/effects); this contributor only maps the
// hits. Kinds handled there: "test-modifier" (any test), "attack-modifier"
// (attack tests only), "characteristic-modifier" (characteristic-keyed).
// ---------------------------------------------------------------------------
testContributors.register("item-effects", (view, context) => {
	return collectEffects(view, {
		channel: "test",
		testKind: context.kind,
		testKey: context.key,
		skillName: context.skillName,
		flags: context.flags,
	}).flatMap((hit) => {
		const modifier = hit.spec.toModifier?.(hit.item, hit.effect, {
			channel: "test",
			testKind: context.kind,
			testKey: context.key,
			skillName: context.skillName,
			flags: context.flags,
		});
		return modifier ? [modifier] : [];
	});
});

/**
 * Guarded-effect condition keys that COULD apply to this test (bead xu83).
 * Offered by the TestDialog as pre-roll toggles: a guarded effect is dropped
 * by the contributor until its flag is set, so the dialog needs to know which
 * guards are in play or the player can never turn one on. Ignores whether the
 * flag is currently set; deduped in first-seen order.
 */
export function collectConditionKeys(
	view: ActorView,
	context: TestModifierContext,
): string[] {
	const keys: string[] = [];
	const hits = collectEffects(view, {
		channel: "test",
		testKind: context.kind,
		testKey: context.key,
		skillName: context.skillName,
		ignoreGuards: true,
	});
	for (const { effect } of hits) {
		const condition = (effect.condition ?? "").trim();
		if (condition && !keys.includes(condition)) keys.push(condition);
	}
	return keys;
}