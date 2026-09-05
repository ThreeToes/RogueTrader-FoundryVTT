/**
 * Talent effect-handler registry - the extension seam for non-modifier talent
 * effects (alongside EntryRegistry for content and funnel contributors for
 * test modifiers).
 *
 * Handlers are registered by KIND (e.g. "wounds-max", "skill-rank") at init
 * via CONFIG.ROGUE_TRADER.talentEffectHandlers (attached in sheet/init.ts).
 * Each handler receives (actor, talent, effect) and returns a pure derived
 * contribution; consumers (rules/derived.ts, sheets) aggregate. Handlers never
 * mutate documents.
 */

import type { Modifier } from "../../rules-engine/src/modifier";

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
	};
}

export interface TalentEffectLike {
	kind?: string;
	testKey?: string | null;
	value?: number;
	label?: string;
	/** Guard from the talentConditions registry; empty = unconditional. */
	condition?: string;
}

export interface TalentLike {
	name?: string;
	system?: { effects?: TalentEffectLike[] };
}

export type TalentEffectHandler = (
	actor: unknown,
	talent: TalentLike,
	effect: TalentEffectLike,
) => unknown;

const handlersByKind = new Map<string, TalentEffectHandler[]>();

export const talentEffectHandlers = {
	/** Register a handler for an effect kind. Repeat adds to that kind. */
	register(kind: string, handler: TalentEffectHandler): void {
		const fns = handlersByKind.get(kind) ?? [];
		fns.push(handler);
		handlersByKind.set(kind, fns);
	},
	/** Effect kinds with at least one handler. */
	kinds(): string[] {
		return [...handlersByKind.keys()];
	},
	/**
	 * Run every handler registered for the effect's kind; results aggregated
	 * by summation. Unknown kinds are ignored (modules add their own).
	 */
	run(actor: unknown, talent: TalentLike, effect: TalentEffectLike): unknown[] {
		const results: unknown[] = [];
		const kind = effect.kind ?? "";
		for (const handler of handlersByKind.get(kind) ?? []) {
			const result = handler(actor, talent, effect);
			if (result !== undefined && result !== null) results.push(result);
		}
		return results;
	},
};

// ---------------------------------------------------------------------------
// Reference handlers.
// ---------------------------------------------------------------------------

/** "wounds-max": additive wound levels (Sound Constitution style). */
talentEffectHandlers.register("wounds-max", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 1);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

/** "skill-rank": additive skill ladder bonus for the keyed characteristic tests. */
talentEffectHandlers.register("skill-rank", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

// ---------------------------------------------------------------------------
// Damage-pipeline kinds (bead fjw). These are consumed by the adapter's
// damage flow via collectTalentDamageEffects below; the reference handlers
// here just expose the raw values through the registry so the kinds are
// discoverable (talentEffectHandlers.kinds()) and reusable by modules.
//
// VERIFY against prose p95-99: Crushing Blow (S 40) "+2 to damage inflicted
// in melee"; Crack Shot (BS 40) "+2 to the Damage when his ranged attack
// causes Critical Damage"; Crippling Strike (WS 50) "+4 Damage" on melee
// criticals.
// ---------------------------------------------------------------------------
talentEffectHandlers.register("damage-flat", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});
talentEffectHandlers.register("critical-damage", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

// ---------------------------------------------------------------------------
// Pure collection helper for the damage pipeline (adapter-side; the kernel
// stays Foundry-free and receives plain numbers).
//
// testKey semantics for damage effects (set by pack authors from the table
// benefit text):
//   ""/undefined  wildcard - applies to melee AND ranged damage
//   "melee"       melee-weapon attacks only (Crushing Blow, Crippling Strike)
//   "ranged"      ranged-weapon attacks only (Crack Shot)
// `condition` guards on the talentConditions registry via flags, mirroring
// the funnel's test-modifier behaviour.
// ---------------------------------------------------------------------------
export interface TalentDamageCollection {
	/** kind "damage-flat" contributors (added before soak). */
	damage: Modifier[];
	/** kind "critical-damage" contributors (applied on critical hits). */
	critical: Modifier[];
}

export function collectTalentDamageEffects(
	actor: unknown,
	opts: { attackType: "melee-weapon" | "ranged-weapon"; flags?: Record<string, boolean> },
): TalentDamageCollection {
	const out: TalentDamageCollection = { damage: [], critical: [] };
	const items = (actor as { items?: Array<ItemLike> }).items;
	if (!items) return out;
	for (const item of items) {
		if (item.type !== "talent") continue;
		for (const effect of item.system?.effects ?? []) {
			const kind = effect.kind ?? "";
			const isDamage = kind === "damage-flat";
			const isCritical = kind === "critical-damage";
			if (!isDamage && !isCritical) continue;
			const key = effect.testKey ?? "";
			const bucket =
				key === ""
					? "any"
					: key === "melee"
						? "melee-weapon"
						: key === "ranged"
							? "ranged-weapon"
							: key;
			if (bucket !== "any" && bucket !== opts.attackType) continue;
			const condition = effect.condition ?? "";
			if (condition && !opts.flags?.[condition]) continue;
			const value = Number(effect.value);
			if (!Number.isFinite(value) || value === 0) continue;
			const mod: Modifier = {
				id: `talent-damage:${kind}:${effect.label ?? ""}:${condition || "any"}`,
				source: { type: "talent", label: "SOURCE.FROM_TALENTS" },
				// Unlabelled effects fall back to the talent's name, never a
				// generic slug.
				label: effect.label || item.name || "",
				value,
				...(condition ? { condition } : {}),
			};
			(isDamage ? out.damage : out.critical).push(mod);
		}
	}
	return out;
}
