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
import { isWeaponType } from "../data/accessors";

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
// Roll-mechanic kinds (bead gci0, Core Rulebook Armoury quality prose):
//   tearing - "roll one extra die for damage, and the lowest result is
//             discarded" (the extra die roll happens in the adapter: the
//             kernel stays number-in/number-out and cannot touch Foundry
//             dice)
//   toxic   - target Toughness test at -5 per damage taken; failure = 1d10
//             Impact with no armour/TB reduction (adapter posts the prompt)
//   blast   - everyone within the blast radius (rating in metres) is also
//             hit; roll location/damage individually (adapter posts the
//             prompt)
// Handlers here are reference/discovery registrations (kinds() lists them,
// the effect editor offers them); the adapter consumes them via
// collectRollMechanicEffects below.
// ---------------------------------------------------------------------------
talentEffectHandlers.register("tearing", () => 1);
talentEffectHandlers.register("toxic", () => 1);
talentEffectHandlers.register("blast", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) ? value : 0;
});

/** Parsed roll-mechanic inputs for one attack (bead gci0). */
export interface RollMechanics {
	tearing: boolean;
	toxic: boolean;
	/** Blast rating in metres ("blast-4"), null when the weapon has none. */
	blast: number | null;
}

/** Parse a weapon's `special` strings into roll-mechanic inputs. */
export function parseSpecialMechanics(special: string[] | undefined): RollMechanics {
	const out: RollMechanics = { tearing: false, toxic: false, blast: null };
	for (const entry of special ?? []) {
		const key = entry.trim().toLowerCase();
		if (key === "tearing") out.tearing = true;
		else if (key === "toxic") out.toxic = true;
		else {
			const blast = /^blast(?:\s*\((\d+)\))?(?:-(\d+))?$/.exec(key);
			if (blast) {
				const rating = Number(blast[1] ?? blast[2] ?? 0);
				out.blast = Number.isFinite(rating) ? rating : 0;
			}
		}
	}
	return out;
}

/**
 * Collect roll-mechanic qualities for an attack (bead gci0): the attacking
 * weapon's `special` strings plus effect-kind contributions (kind "tearing"/
 * "toxic"/"blast", value = blast rating) from talents and the weapon itself.
 * Pure; the adapter turns the result into dice rolls and card notes.
 */
export function collectRollMechanicEffects(
	actor: unknown,
	opts: { weaponId?: string; attackType: "melee-weapon" | "ranged-weapon" },
): RollMechanics {
	const out: RollMechanics = { tearing: false, toxic: false, blast: null };
	const items = (actor as { items?: ItemLike[] }).items ?? [];
	for (const item of items) {
		const isTalent = item.type === "talent";
		const isWeapon =
			opts.weaponId !== undefined &&
			item.id === opts.weaponId &&
			isWeaponType(item.type);
		if (!isTalent && !isWeapon) continue;
		const special = (
			item.system as unknown as { special?: string[] } | undefined
		)?.special;
		if (isWeapon && special) {
			const parsed = parseSpecialMechanics(special);
			out.tearing ||= parsed.tearing;
			out.toxic ||= parsed.toxic;
			if (parsed.blast !== null) out.blast = Math.max(out.blast ?? 0, parsed.blast);
		}
		for (const effect of item.system?.effects ?? []) {
			const kind = effect.kind ?? "";
			if (kind !== "tearing" && kind !== "toxic" && kind !== "blast") continue;
			if (kind === "tearing") out.tearing = true;
			else if (kind === "toxic") out.toxic = true;
			else {
				const rating = Number(effect.value ?? 0);
				if (Number.isFinite(rating)) {
					out.blast = Math.max(out.blast ?? 0, rating);
				}
			}
		}
	}
	return out;
}

/**
 * Tearing die math (bead gci0, Core Rulebook: "roll one extra die for
 * damage, and the lowest result is discarded"). Pure: given the results of
 * the damage roll's dice of size `faces` and the extra die result, returns
 * the net addition (extra minus the discarded lowest) — always >= 0 when
 * `extra` ties or beats the lowest.
 */
export function applyTearing(
	diceResults: number[],
	extra: number,
	faces: number,
): { added: number; discarded: number } {
	const relevant = [...diceResults.filter((r) => Number.isFinite(r)), extra];
	const discarded = Math.min(...relevant);
	return { added: extra - discarded, discarded };
}

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
	opts: {
		attackType: "melee-weapon" | "ranged-weapon";
		flags?: Record<string, boolean>;
		/** The attacking weapon's id (bead 2k5): its own damage effects apply. */
		weaponId?: string;
	},
): TalentDamageCollection {
	const out: TalentDamageCollection = { damage: [], critical: [] };
	const items = (actor as { items?: Array<ItemLike & { id?: string; equipState?: string }> })
		.items;
	if (!items) return out;
	for (const item of items) {
		// Bead 2k5: damage effects apply from (a) talents (always live) and
		// (b) the attacking weapon ITSELF, when carried. Armour/gear damage
		// effects have no book basis and stay inert (documented decision;
		// worn armour adding damage is not a RT core rule).
		const isTalent = item.type === "talent";
		const isAttackingWeapon =
			opts.weaponId !== undefined &&
			item.id === opts.weaponId &&
			isWeaponType(item.type) &&
			(item.equipState === undefined || item.equipState === "carried");
		if (!isTalent && !isAttackingWeapon) continue;
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
			const idPrefix = isTalent ? "talent-damage" : "weapon-damage";
			const sourceLabel = isTalent ? "SOURCE.FROM_TALENTS" : "SOURCE.FROM_WEAPONS";
			const mod: Modifier = {
				id: `${idPrefix}:${item.name ?? ""}:${kind}:${effect.label ?? ""}:${condition || "any"}`,
				source: {
					type: isTalent ? "talent" : "item",
					label: sourceLabel,
				},
				// Unlabelled effects fall back to the owning item's name, never
				// a generic slug. Item name is in the id so same-shaped effects
				// on different weapons stay additive (funnel dedupe lesson).
				label: effect.label || item.name || "",
				value,
				...(condition ? { condition } : {}),
			};
			(isDamage ? out.damage : out.critical).push(mod);
		}
	}
	return out;
}
