import type { Modifier } from "../../rules-engine/src/modifier";
import type { ActorView } from "../domain/model/actor";
import type { TestKind } from "../domain/model/test";
import { collectEffects } from "../domain/effects";
import { HandlerRegistry } from "../domain/registry";
import {
	resolveFireModeBonus,
	type HomebrewProfile,
} from "./homebrew";
import {
	resolveOriginTraits,
	traitModifierId,
	type OriginTraitDef,
} from "./origin-traits";

/**
 * Modifier funnel: the single collection point between the system's data and
 * the rules engine. Sources push `Modifier` values in; consumers (roll
 * dialogs, chat cards) receive an ordered breakdown and a total.
 *
 * The item-effect walk lives in the effect engine (domain/effects): this module
 * registers the contributors and runs them over an `ActorView`. New sources
 * never touch sheet or roll code.
 *
 * Built-in contributors:
 * - "effect": ActiveEffect changes keyed `system.testModifier` become additive
 *   modifiers (change value parsed as a number).
 * - "weapon-qualities": when a test carries a weapon, known qualities map to
 *   fixed contributions (data table below; values are remembered RT core
 *   rules, flagged for verification).
 */
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
// Built-in contributor: origin traits (bead tgq9). Traits derive at runtime
// from Character.system.origins -> cached pack definitions. Modifier-kind
// traits contribute test modifiers with stable ids (additive); grants/notes
// render on the Background tab and never contribute here.
// ---------------------------------------------------------------------------
testContributors.register("origin-traits", (view, context) => {
	const getDefs =
		typeof CONFIG !== "undefined"
			? (
					CONFIG as unknown as {
						ROGUE_TRADER?: {
							originTraits?: { getDefs?: () => OriginTraitDef[] };
						};
					}
				).ROGUE_TRADER?.originTraits?.getDefs
			: undefined;
	const defs = getDefs?.() ?? [];
	if (defs.length === 0) return [];
	const origins = view.system.origins as never;
	if (!origins) return [];
	// Pure resolution (rules/origin-traits; no import cycle — it does not
	// import the funnel).
	const { modifiers } = resolveOriginTraits(origins, defs);
	return modifiers
		.filter((m) => m.def.testKey === "" || m.def.testKey === context.key)
		.map((m) => ({
			id: traitModifierId(m.def),
			source: { type: "item", label: "BACKGROUND.ORIGINS" },
			label: m.def.name,
			value: m.def.value,
		}));
});

// ---------------------------------------------------------------------------
// Built-in contributor: attack action modifiers (bead hyv). Values VERIFIED
// against the core action table (p237):
//   Semi-Auto Burst: "+10 to BS, additional hit for every two degrees"
//   Full Auto Burst: "+20 to BS, additional hit for every degree"
// Additional hits are out of scope here (to-hit modifier only).
// ---------------------------------------------------------------------------
testContributors.register("attack-context", (_view, context) => {
	if (context.kind !== "attack") return [];
	const mods: Modifier[] = [];
	// Bead 9if: homebrew profile overrides the core fire-mode bonuses via a
	// provider attached at init (CONFIG.ROGUE_TRADER.homebrew.getProfile).
	const homebrewProvider =
		typeof CONFIG !== "undefined"
			? (
					CONFIG as unknown as {
						ROGUE_TRADER?: {
							homebrew?: { getProfile?: () => HomebrewProfile | null };
						};
					}
				).ROGUE_TRADER?.homebrew?.getProfile
			: undefined;
	const homebrew = homebrewProvider?.() ?? null;
	if (context.fireMode === "burst") {
		const burst = resolveFireModeBonus(homebrew, "burst");
		if (burst !== null) {
			mods.push({
				id: "attack:fire-mode:burst",
				source: { type: "item", label: "ROLL.FIRE_MODE_BURST" },
				label: "Semi-Auto Burst",
				value: burst,
			});
		}
	}
	if (context.fireMode === "full") {
		const full = resolveFireModeBonus(homebrew, "full");
		if (full !== null) {
			mods.push({
				id: "attack:fire-mode:full",
				source: { type: "item", label: "ROLL.FIRE_MODE_FULL" },
				label: "Full Auto Burst",
				value: full,
			});
		}
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
