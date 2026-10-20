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
	/**
	 * The contributors registered under one source type, in registration
	 * order (bead 4tx6): lets a system's explicit-registrar compare HANDLES,
	 * so a foreign module registering the same type key can never satisfy its
	 * applied-guard by key shape alone.
	 */
	contributorsFor(type: string): readonly TestContributor[] {
		return contributors.for(type);
	},
	/**
	 * Run every registered contributor. Malformed results (a forgotten return,
	 * a bare Modifier instead of an array, a non-moder element) warn at this
	 * seam naming the registry and source type (bead otpj) and contribute
	 * nothing — the failure is loud, not a silently-short breakdown row.
	 */
	run(view: ActorView, context: TestModifierContext): Modifier[] {
		const out: Modifier[] = [];
		// keys()/for() walks the same handlers as all(), but keeps the source
		// type so a malformed return can name it in the warning.
		for (const type of contributors.keys()) {
			for (const fn of contributors.for(type)) {
				out.push(
					...normalizeContributorResult(fn(view, context), type, context),
				);
			}
		}
		return out;
	},
};

/** Registry name used in the seam's loud-failure warnings (bead otpj). */
const REGISTRY_NAME = "test-contributors";

function isModifierLike(value: unknown): boolean {
	const mod = value as Modifier;
	return (
		typeof value === "object" &&
		value !== null &&
		typeof mod.id === "string" &&
		typeof mod.label === "string" &&
		typeof mod.value === "number" &&
		Number.isFinite(mod.value) &&
		// Bead xpeh: `source` is part of every Modifier (`m.source.label` is read
		// at the dialog seam) — a source-less row must be rejected here, not
		// crash later with a TypeError.
		typeof mod.source?.type === "string" &&
		typeof mod.source?.label === "string"
	);
}

/** Serialization best effort — a malformed element may not stringify. */
function describeValue(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return "<unserializable>";
	}
}

/**
 * The seam's loud-failure gate (bead otpj): a contributor's result must be a
 * `Modifier` array. Anything else warns (naming the source type) and drops
 * the value; well-formed elements inside a malformed-shaped array are kept.
 */
function normalizeContributorResult(
	result: unknown,
	type: string,
	context: TestModifierContext,
): Modifier[] {
	if (result === undefined || result === null) {
		console.warn(
			`[${REGISTRY_NAME}] "${type}" contributor returned ${String(result)} — forgot its return? Expected Modifier[]; contributed nothing ` +
				`(${context.kind} test "${context.key}").`,
		);
		return [];
	}
	if (!Array.isArray(result)) {
		console.warn(
			`[${REGISTRY_NAME}] "${type}" contributor returned a bare ${typeof result} — expected Modifier[]; contributed nothing ` +
				`(${context.kind} test "${context.key}").`,
		);
		return [];
	}
	const out: Modifier[] = [];
	for (const mod of result as unknown[]) {
		if (isModifierLike(mod)) {
			out.push(mod as Modifier);
		} else {
			console.warn(
				`[${REGISTRY_NAME}] "${type}" contributor emitted a malformed modifier — expected {id, label, value}. ` +
					`Got: ${describeValue(mod)}; dropped (${context.kind} test "${context.key}").`,
			);
		}
	}
	return out;
}

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

/**
 * QUALITY.<SLUG> i18n key for a weapon-quality slug (bead dfdv): the funnel
 * stays Foundry-free, so it emits the KEY ("gyro-stabilised" →
 * "QUALITY.GYRO_STABILISED" — the shape lang/*.json uses) and the display
 * seams localize it for rendering.
 */
export function qualityLabelKey(quality: string): string {
	return `QUALITY.${quality.toUpperCase().replace(/-/g, "_")}`;
}

testContributors.register("weapon-qualities", (_view, context) => {
	if (context.kind !== "attack" || !context.weapon) return [];
	const special = context.weapon.special ?? [];
	const mods: Modifier[] = [];
	for (const quality of special) {
		const compute = QUALITY_CONTRIBUTIONS[quality];
		if (!compute) continue;
		const value = compute(context);
		if (value === null || value === 0) continue;
		// Bead dfdv: the label is the QUALITY.<SLUG> KEY (Foundry-free); the
		// display seams localize it via localizeLabel.
		mods.push({
			id: `quality:${quality}`,
			source: { type: "item", label: "WEAPON.SPECIAL" },
			label: qualityLabelKey(quality),
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
