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
import type { ActorView } from "../domain/model/actor";
import { collectEffects } from "../domain/effects";
import { isWeaponType } from "../data/accessors";

export interface TalentEffectLike {
	kind?: string;
	testKey?: string | null;
	value?: number;
	/** Dice expression for dice-valued kinds (e.g. "corruption"). */
	dice?: string;
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

// Target-side trait damage kinds (bead zyv1): discovery/registry entries so
// the effect editor offers them and talentEffectHandlers.kinds() lists them.
// Consumed from the TARGET's trait items by collectTargetTraitDamageEffects
// (below) — NOT from talents, whose damage kinds are attacker-side (bead fjw).
talentEffectHandlers.register("tb-multiplier", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value > 0 ? value : null;
});
talentEffectHandlers.register("damage-reduction", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

// Corruption-on-manifest kind (epic 0hap): the Summon Daemon power prints
// "1d10+4 Corruption Points" (Edge of the Abyss p83). The adapter rolls the
// `dice` expression after a successful Focus Power Test; this reference
// registration makes the kind discoverable to the effect editor.
talentEffectHandlers.register("corruption", (_actor, _talent, effect) => {
	const dice = effect.dice?.trim();
	if (dice) return dice;
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

// Sorcery kinds (epic 0hap, Edge of the Abyss pp85-86).
//   sorcery-rank    - the Sorcerer (1) / Master Sorcerer (2) talents; sets the
//                     Intelligence-Bonus Psy Rating the caster uses.
//   grants-technique - the Sorcerer / Sorcerous Power talents grant one
//                     psychic technique; the interactive pick + castAs flag is
//                     the psychic picker's job (the reference handler here
//                     makes the intent expressible and discoverable).
talentEffectHandlers.register("sorcery-rank", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value > 0 ? value : null;
});
talentEffectHandlers.register("grants-technique", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 1);
	return Number.isFinite(value) && value > 0 ? value : 1;
});

/**
 * Highest sorcery rank the actor's talents grant (epic 0hap): 0 = none,
 * 1 = Sorcerer (half Int-Bonus Psy Rating), 2 = Master Sorcerer (full).
 * `casting.ts` combines this with the manual actor field. Pure.
 */
export function collectSorceryRank(view: ActorView): number {
	let rank = 0;
	for (const hit of collectEffects(view, {
		channel: "derived",
		itemWhere: (item) => item.type === "talent",
	})) {
		if (hit.spec.kind !== "sorcery-rank") continue;
		const value = hit.spec.read?.(hit.item, hit.effect, { channel: "derived" });
		if (typeof value === "number") rank = Math.max(rank, value);
	}
	return rank;
}

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
			} else if (key.startsWith("blast")) {
				// Loud failure (bead dfb8): variable ratings the book prints as
				// dice (e.g. Ork Bomb Squig "Blast (1d5)", ITS Table 3-17) cannot
				// resolve to a static radius. Ignoring them silently would hide a
				// modifier; warn so the data gets fixed or the engine extended.
				console.warn(
					`rogue-trader: unparseable blast quality "${entry}" — no static blast radius applied.`,
				);
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
	view: ActorView,
	opts: {
		weaponId?: string;
		attackType: "melee-weapon" | "ranged-weapon";
		/**
		 * The attacking profile's own qualities (bead kam1). A mutation's printed
		 * attack block carries its qualities in `attack.qualities` rather than on
		 * a weapon Item's `system.special`, so the caller passes them in; weapon
		 * attacks keep resolving through their own item and leave this unset.
		 */
		special?: string[];
	},
): RollMechanics {
	const out: RollMechanics = { tearing: false, toxic: false, blast: null };
	const absorb = (parsed: RollMechanics) => {
		out.tearing ||= parsed.tearing;
		out.toxic ||= parsed.toxic;
		if (parsed.blast !== null) out.blast = Math.max(out.blast ?? 0, parsed.blast);
	};
	if (opts.special?.length) absorb(parseSpecialMechanics(opts.special));
	const itemWhere = (item: { type: string; id: string }) =>
		item.type === "talent" ||
		(opts.weaponId !== undefined &&
			item.id === opts.weaponId &&
			isWeaponType(item.type));
	for (const hit of collectEffects(view, {
		channel: "roll-mechanic",
		weaponId: opts.weaponId,
		itemWhere,
	})) {
		if (hit.spec.kind === "tearing") out.tearing = true;
		else if (hit.spec.kind === "toxic") out.toxic = true;
		else if (hit.spec.kind === "blast") {
			const rating = hit.spec.read?.(hit.item, hit.effect, {
				channel: "roll-mechanic",
			});
			if (typeof rating === "number") {
				out.blast = Math.max(out.blast ?? 0, rating);
			}
		}
	}
	const weapon =
		opts.weaponId !== undefined
			? view.items.find((item) => item.id === opts.weaponId)
			: undefined;
	if (weapon?.special.length) absorb(parseSpecialMechanics([...weapon.special]));
	return out;
}

// ---------------------------------------------------------------------------
// Target-side trait damage machinery (bead zyv1). Rulebook traits (Ch XIV,
// Core Rulebook) are INNATE items (type "trait", always live per
// effectsAreLive) whose effect rows shape how incoming damage is soaked:
//
//   tb-multiplier    Unnatural Toughness (×2): value = the multiplier (2).
//                    Applied to the target's Toughness Bonus by the adapter.
//   damage-reduction Machine-style flat soak: value = soak points. Penetration
//                    does NOT touch it (only armour absorbs Pen).
//
// NOTE (pack decision): the npcs pack expresses Machine (X) as a standalone
// armour item (statblocks print it as "Armour (Machine): All X"), so those
// NPCs must NOT also carry damage-reduction rows — that would double-count.
// The damage-reduction kind exists for traits where the book pins a flat
// soak without armour semantics.
// ---------------------------------------------------------------------------
export interface TargetTraitDamageCollection {
	/** kind "tb-multiplier": the multiplier value (natural = 1, ×2 = 2, ...). */
	tbMultiplier: number | null;
	/** kind "damage-reduction" contributors (added to soak, post-Pen). */
	reduction: Modifier[];
}

/**
 * TB multiplier for one target (bead zyv1): the STRONGER of the canonical
 * characteristics.t.unnatural field and the trait tb-multiplier effects.
 * They express the same book trait, so combining them must never
 * double-count — max wins. Never below 1 (natural).
 */
export function targetToughnessMultiplier(
	view: ActorView,
	collected: TargetTraitDamageCollection,
): number {
	const unnatural = view.system.characteristics?.t?.unnatural ?? 1;
	return Math.max(1, unnatural, collected.tbMultiplier ?? 1);
}

/**
 * Collect damage-side effects from the TARGET's trait items (bead zyv1).
 * Pure; the adapter turns the result into TB multiplier and flat soak and
 * keeps the rows visible in the damage-card breakdown.
 */
export function collectTargetTraitDamageEffects(
	view: ActorView,
): TargetTraitDamageCollection {
	const out: TargetTraitDamageCollection = { tbMultiplier: null, reduction: [] };
	for (const hit of collectEffects(view, {
		channel: "target-soak",
		itemWhere: (item) => item.type === "trait",
	})) {
		if (hit.spec.kind === "tb-multiplier") {
			const value = hit.spec.read?.(hit.item, hit.effect, {
				channel: "target-soak",
			});
			if (typeof value === "number") {
				out.tbMultiplier = Math.max(out.tbMultiplier ?? 0, value);
			}
		} else if (hit.spec.kind === "damage-reduction") {
			const modifier = hit.spec.toModifier?.(hit.item, hit.effect, {
				channel: "target-soak",
			});
			if (modifier) out.reduction.push(modifier);
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
	view: ActorView,
	opts: {
		attackType: "melee-weapon" | "ranged-weapon";
		flags?: Record<string, boolean>;
		/** The attacking weapon's id (bead 2k5): its own damage effects apply. */
		weaponId?: string;
	},
): TalentDamageCollection {
	const out: TalentDamageCollection = { damage: [], critical: [] };
	// Bead 2k5: damage effects apply from (a) talents (always live) and (b) the
	// attacking weapon ITSELF, when carried. Armour/gear damage effects have no
	// book basis and stay inert (documented decision).
	const itemWhere = (item: { type: string; id: string }) =>
		item.type === "talent" ||
		(opts.weaponId !== undefined &&
			item.id === opts.weaponId &&
			isWeaponType(item.type));
	for (const hit of collectEffects(view, {
		channel: "damage",
		attackType: opts.attackType,
		weaponId: opts.weaponId,
		flags: opts.flags,
		itemWhere,
	})) {
		const modifier = hit.spec.toModifier?.(hit.item, hit.effect, {
			channel: "damage",
			attackType: opts.attackType,
			weaponId: opts.weaponId,
			flags: opts.flags,
		});
		if (!modifier) continue;
		if (hit.spec.kind === "critical-damage") out.critical.push(modifier);
		else out.damage.push(modifier);
	}
	return out;
}
