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
 * System-specific contributors (RT origin traits, RT fire-mode homebrew, RT
 * weapon qualities) register themselves from their sibling system modules —
 * this file holds only the machinery and the FFG-generic contributors, so it
 * stays system-neutral and Foundry-free (application layer, epic kof0).
 * Bead gyei hoisted the LAST RT book table (the "weapon-qualities"
 * contribution table) into src/roguetrader/rules/weapon-qualities.ts.
 *
 * Built-in contributors:
 * - "effect": ActiveEffect changes keyed `system.testModifier` become additive
 *   modifiers (change value parsed as a number).
 * - "item-effects": owned-item effect kinds through the effect engine.
 */

import type { ConfigPort, I18n } from "./ports";
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
	/**
	 * The config + i18n ports a system contributor needs (bead x4ly).
	 *
	 * Threaded by the presentation seams that build contexts (the roll
	 * pipeline, the TestDialog re-collection); a context that carries none
	 * makes a port-asking system contributor contribute nothing — loudly,
	 * via the warn-ONCE helper — so a second system can bind its OWN config
	 * port per call instead of the rules layer reaching a global.
	 */
	ports?: TestContributorPorts;
}

/** The narrow port pair a system funnel contributor reads (bead x4ly). */
export interface TestContributorPorts {
	config: ConfigPort;
	i18n: I18n;
}

/**
 * Read the contributor ports off a context, warn-ONCE when absent (bead x4ly).
 *
 * A system contributor that needs the config or i18n port calls this; when
 * the caller threaded no ports (an old call site, a bare test) the row would
 * otherwise vanish SILENTLY — a silent modifier, which is a bug. Loud, but
 * not spammy: one warning per process covers every later port-less call.
 * Returns null then; the contributor contributes nothing.
 */
let warnedMissingContributorPorts = false;
export function contributorPorts(
	context: TestModifierContext,
): TestContributorPorts | null {
	if (context.ports) return context.ports;
	if (!warnedMissingContributorPorts) {
		warnedMissingContributorPorts = true;
		console.warn(
			`[${REGISTRY_NAME}] a system contributor asked for its ports but the TestModifierContext carried none — thread { config, i18n } at the context-building seam; the contribution is dropped.`,
		);
	}
	return null;
}

/**
 * Test teardown for the warn-once flag above: a suite that pins the
 * "missing contributor ports" warning must be able to reset the
 * one-shot state, or the pin only holds when it happens to run first.
 */
export function resetContributorPortsWarningForTests(): void {
	warnedMissingContributorPorts = false;
}

export type TestContributor = (
	view: ActorView,
	context: TestModifierContext,
) => Modifier[];

const contributors = new HandlerRegistry<string, TestContributor>();

/**
 * Source-type key storage (bead 00z5): a registering system may namespace
 * its keys, following the `createRegistries(seed, "ROGUE_TRADER")`
 * CONFIG-namespace precedent, so two FFG systems registering their own
 * "attack-context" contributor hold SEPARATE handler lists instead of
 * silently merging rows (the first-wins-by-module-import-order class).
 * Un-namespaced keys — the built-ins, a system that has not migrated —
 * resolve exactly as before.
 */
function namespacedKey(system: string | undefined, type: string): string {
	return system === undefined ? type : `${system}:${type}`;
}

export const testContributors = {
	/**
	 * Register a contributor for a source type. A reference-identical repeat
	 * is a no-op (HandlerRegistry.on); `system` namespaces the key (bead 00z5).
	 */
	register(type: string, fn: TestContributor, system?: string): void {
		contributors.on(namespacedKey(system, type), fn);
	},
	/**
	 * Remove one contributor — the teardown affordance tests use so a
	 * registration in one suite cannot leak into the next suite in the same
	 * process (bead 00z5). Same `system` form as the registration.
	 */
	off(type: string, fn: TestContributor, system?: string): boolean {
		return contributors.off(namespacedKey(system, type), fn);
	},
	/**
	 * Drop a whole source type (or all types when type is omitted). Pass the
	 * same form you registered with — a namespaced key is its own storage
	 * slot, so `clear("t")` never touches "SYSTEM:t".
	 */
	clear(type?: string): void {
		if (type === undefined) contributors.clear();
		else contributors.clear(type);
	},
	/** Storage keys with at least one contributor; namespaced keys carry
	 * their `SYSTEM:` prefix (newest key last). */
	types(): string[] {
		return contributors.keys();
	},
	/**
	 * The contributors registered under one source type, in registration
	 * order (bead 4tx6): lets a system's explicit-registrar compare HANDLES,
	 * so a foreign module registering the same type key can never satisfy its
	 * applied-guard by key shape alone. Same `system` form as registration.
	 */
	contributorsFor(type: string, system?: string): readonly TestContributor[] {
		return contributors.for(namespacedKey(system, type));
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
		// type — including its namespace prefix — so a malformed return can
		// name it in the warning.
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
				`[${REGISTRY_NAME}] "${type}" contributor emitted a malformed modifier — expected {id, label, value, source: {type, label}}. ` +
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

/**
 * QUALITY.<SLUG> i18n key for a weapon-quality slug (bead dfdv): the funnel
 * stays Foundry-free, so it emits the KEY ("gyro-stabilised" →
 * "QUALITY.GYRO_STABILISED" — the shape lang/*.json uses) and the display
 * seams localize it for rendering.
 */
export function qualityLabelKey(quality: string): string {
	return `QUALITY.${quality.toUpperCase().replace(/-/g, "_")}`;
}

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
