import type { Modifier } from "../../rules-engine/src/modifier";
import { effectsAreLive } from "../data/item/effects";
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
	| "vehicle-handling"
	// Focus Power Test (bead sa6, Core Rulebook p157): a Characteristic/Skill test
	// with the +5-per-effective-PR bonus expressed as a funnel-visible
	// modifier, so power/talent effects contribute via the normal funnel.
	| "focus-power";

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
	// Accurate: VERIFIED book p115-116 (PDF p116): +10 to BS with an Aim
	// Action, in addition to the aiming bonus. (Extra d10 per two degrees
	// on a single shot = damage-pipeline work, bead gci0.)
	accurate: (context) =>
		context.aimed && context.kind === "attack" ? 10 : null,
	// Defensive: VERIFIED book p115 (PDF p116): +15 to Parry but -10 when
	// used to make attacks. The parry side needs parry-context plumbing
	// (bead gci0, with Balanced/Unbalanced); the attack penalty lives here.
	defensive: (context) => (context.kind === "attack" ? -10 : null),
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
// Built-in contributor: origin traits (bead tgq9). Traits derive at runtime
// from Character.system.origins -> cached pack definitions (CONFIG.ROGUE_TRADER
// .originTraits.getDefs, attached at init). Modifier-kind traits contribute
// test modifiers with stable ids (additive); grants/notes render on the
// Background tab and never contribute here.
// ---------------------------------------------------------------------------
testContributors.register("origin-traits", (actor, context) => {
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
	const origins = (actor as { system?: { origins?: Record<string, unknown> } })
		.system?.origins as never;
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
// Aim (+10/+20) is surfaced as a dialog-contributed modifier in the adapter;
// charge (+10 WS, Berserk Charge replaces it with +20) is a condition flag,
// see the talent contributor below.
// ---------------------------------------------------------------------------
testContributors.register("attack-context", (_actor, context) => {
	if (context.kind !== "attack") return [];
	const mods: Modifier[] = [];
	// Bead 9if: homebrew profile overrides the core fire-mode bonuses via a
	// provider attached at init (CONFIG.ROGUE_TRADER.homebrew.getProfile);
	// absent provider = core rules (Core Rulebook p237). Guarded for pure-test
	// environments where the Foundry global is absent.
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
// Built-in contributor: owned item effects -> test modifiers (funnel v2).
// Each item's effects (kind/testKey/value/label, see data/item/effects.ts)
// map to Modifier[]; empty testKey acts as wildcard across all tests. Attack
// tests carry context.key = "bs"/"ws", so keyed effects only apply to
// matching tests - mirror of the weapon-qualities contributor.
//
// Items contribute only when live (effectsAreLive, bead yb6): talents are
// always "known"; physical items must be equipped (worn armour, carried gear
// and weapons).
//
// Kinds handled here (bead fjw):
// - "test-modifier": applies to every test kind (default/legacy shape).
// - "attack-modifier": applies to ATTACK tests only (Berserk Charge +20 when
//   charging, Gunslinger, ...). Verified against prose p95-99: these talents
//   modify the attack roll, not arbitrary characteristic/skill tests.
// Other kinds (damage-flat, critical-damage, wounds-max, ...) belong to their
// registered handlers / the damage pipeline (rules/talent-effects.ts).
// ---------------------------------------------------------------------------
interface ItemLike {
	name?: string;
	type?: string;
	system?: {
		effects?: Array<{
			kind?: string;
			testKey?: string;
			value?: number;
			label?: string;
			condition?: string;
		}>;
		equipState?: string;
	};
}

const SOURCE_LABELS: Record<string, string> = {
	talent: "SOURCE.FROM_TALENTS",
	// Rulebook traits (Ch XIV) are innate items; their test-side effect rows
	// flow through the same contributor (bead zyv1).
	trait: "SOURCE.FROM_TRAITS",
	armour: "SOURCE.FROM_ARMOUR",
	gear: "SOURCE.FROM_GEAR",
	"melee-weapon": "SOURCE.FROM_WEAPONS",
	"ranged-weapon": "SOURCE.FROM_WEAPONS",
};

testContributors.register("item-effects", (actor, context) => {
	const items = (actor as { items?: Array<ItemLike> }).items;
	if (!items) return [];
	const mods: Modifier[] = [];
	for (const item of items) {
		const type = item.type ?? "";
		if (!effectsAreLive(type, item.system?.equipState)) continue;
		for (const effect of item.system?.effects ?? []) {
			// Only test-modifier kinds feed the funnel; damage kinds belong to
			// the damage pipeline (collectTalentDamageEffects) and other kinds
			// to their registered handlers (rules/talent-effects.ts).
			const kind = (effect as { kind?: string }).kind;
			const isTestModifier = kind === undefined || kind === "" || kind === "test-modifier";
			const isAttackModifier =
				kind === "attack-modifier" && context.kind === "attack";
			if (!isTestModifier && !isAttackModifier) continue;
			const key = effect.testKey;
			// "skill:<name>" test keys (bead r1k) match the SKILL test's item
			// name (lowercased), not the characteristic — gear/drug/tool
			// bonuses like "Medikit: +20 Medicae Tests" must not hit every
			// Int-characteristic test.
			if (key?.startsWith("skill:")) {
				if (
					context.skillName?.toLowerCase() !==
					key.slice("skill:".length).toLowerCase()
				) {
					continue;
				}
			} else if (key !== "" && key !== undefined && key !== context.key) {
				continue;
			}
			// Guarded effects (bead czx) only apply when the matching context
			// flag is set; the condition label rides on the Modifier for the
			// chat/dialog breakdown.
			const condition = (effect as { condition?: string }).condition;
			if (condition) {
				if (!context.flags?.[condition]) continue;
			}
			const value = Number(effect.value);
			if (!Number.isFinite(value) || value === 0) continue;
			const isTalent = type === "talent";
			const idPrefix = isTalent ? "talent" : `item:${type}`;
			// The owning item's name must be part of the id: two different
			// talents/gear can contribute identical (label, testKey, condition)
			// triples and every one of them is additive (bug report: only the
			// first showed). Dedupe must only collapse the SAME source's
			// re-collected rows across the dialog round-trip.
			mods.push({
				id: `${idPrefix}:${item.name ?? ""}:${kind === "attack-modifier" ? "attack" : key || "any"}:${effect.label ?? ""}:${condition || "any"}`,
				source: {
					type: isTalent ? "talent" : "item",
					label: SOURCE_LABELS[type] ?? "SOURCE.FROM_GEAR",
				},
				// Unlabelled effects fall back to the owning item's name (the
				// talent/gear name), never the raw type slug.
				label: effect.label || item.name || "",
				value,
				...(condition ? { condition } : {}),
			});
		}
	}
	return mods;
});
