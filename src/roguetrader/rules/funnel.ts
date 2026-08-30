import type { Modifier } from "../../../packages/rules-engine/src/modifier";

/**
 * Modifier funnel: the single collection point between the system's data and
 * the rules engine. Sources push `Modifier` values in; consumers (roll
 * dialogs, chat cards) receive an ordered breakdown and a total.
 *
 * v2 adds the contributor registry - the rules-layer analogue of
 * EntryRegistry: modules register contributor functions at init (attached to
 * CONFIG.ROGUE_TRADER in sheet/init.ts) and collectTestModifiers runs them
 * all. New sources never touch sheet or roll code.
 *
 * Built-in contributors are pure functions over system data:
 * - "effect": ActiveEffect changes keyed `system.testModifier` become additive
 *   modifiers (change value parsed as a number).
 * - "weapon-qualities": when a test carries a weapon, known qualities map to
 *   fixed contributions (data table below; values are remembered RT core
 *   rules, flagged for verification).
 */
/** Test kinds that reach the funnel. */
export type TestKind =
	| "characteristic"
	| "skill"
	| "attack"
	| "vehicle-handling";

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
}

export type TestContributor = (
	actor: unknown,
	context: TestModifierContext,
) => Modifier[];

const contributorsByType = new Map<string, TestContributor[]>();

export const testContributors = {
	/** Register a contributor for a source type. Repeat adds to that type. */
	register(type: string, fn: TestContributor): void {
		const fns = contributorsByType.get(type) ?? [];
		fns.push(fn);
		contributorsByType.set(type, fns);
	},
	/** Source types with at least one contributor (newest last). */
	types(): string[] {
		return [...contributorsByType.keys()];
	},
	/** Run every registered contributor; malformed results are ignored. */
	run(actor: unknown, context: TestModifierContext): Modifier[] {
		const out: Modifier[] = [];
		for (const fns of contributorsByType.values()) {
			for (const fn of fns) {
				const mods = fn(actor, context) ?? [];
				if (Array.isArray(mods)) out.push(...mods);
			}
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
	actor: unknown,
	context: TestModifierContext,
	extra: Modifier[] = [],
): Modifier[] {
	return mergeModifiers(extra, testContributors.run(actor, context));
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
	// Accurate: +10 when taking an aimed Ballistic Skill test. VERIFY book.
	accurate: (context) =>
		context.aimed && context.kind === "attack" ? 10 : null,
};

testContributors.register("weapon-qualities", (_actor, context) => {
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
testContributors.register("effect", (actor) => {
	const effects = (
		actor as {
			appliedEffects?: Array<{
				id?: string;
				name?: string;
				changes?: Array<{ key?: string; value?: unknown }>;
			}>;
		}
	).appliedEffects;
	if (!Array.isArray(effects)) return [];
	const mods: Modifier[] = [];
	for (const effect of effects) {
		for (const change of effect.changes ?? []) {
			if (change.key !== "system.testModifier") continue;
			const value = Number(change.value);
			if (!Number.isFinite(value) || value === 0) continue;
			mods.push({
				id: `effect:${effect.id ?? effect.name ?? "unnamed"}`,
				source: { type: "effect", label: effect.name ?? "Effect" },
				label: effect.name ?? "Effect",
				value,
			});
		}
	}
	return mods;
});

// ---------------------------------------------------------------------------
// Built-in contributor: owned talent items -> test modifiers (funnel v2). Each
// talent's effects (testKey/value/label, see data/item/talent.ts) map to
// Modifier[]; empty testKey acts as wildcard across all tests. Attack tests
// carry context.key = "bs"/"ws", so keyed effects only apply to matching
// tests - mirror of the weapon-qualities contributor.
// ---------------------------------------------------------------------------
interface ItemLike {
	type?: string;
	system?: { effects?: Array<{ testKey?: string; value?: number; label?: string }> };
}
testContributors.register("talent", (actor, context) => {
	const items = (
		actor as { items?: Array<ItemLike> }
	).items;
	if (!items) return [];
	const list = Array.isArray(items) ? items : [...items.values()];
	const mods: Modifier[] = [];
	for (const item of list) {
		if (item.type !== "talent") continue;
		for (const effect of item.system?.effects ?? []) {
			const key = effect.testKey;
			if (key !== "" && key !== undefined && key !== context.key) continue;
			const value = Number(effect.value);
			if (!Number.isFinite(value) || value === 0) continue;
			mods.push({
				id: `talent:${key || "any"}:${effect.label ?? ""}`,
				source: { type: "talent", label: "TALENT.HEADER" },
				label: effect.label || "Talent",
				value,
			});
		}
	}
	return mods;
});