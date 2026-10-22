/**
 * Talent effect-handler registry - the extension seam for non-modifier talent
 * effects (alongside EntryRegistry for content and funnel contributors for
 * test modifiers).
 *
 * Handlers are registered by KIND (e.g. "wounds-max", "skill-rank") at init
 * via CONFIG.ROGUE_TRADER.talentEffectHandlers (attached in bootstrap/config.ts).
 * Each handler receives (actor, talent, effect) and returns a pure derived
 * contribution; consumers (rules/derived.ts, sheets) aggregate. Handlers never
 * mutate documents.
 *
 * Bead z5nq: the kinds the SYSTEM itself ships are registered ONCE, in
 * ffg/domain/effects/specs.ts (labelKey + channels + read/toModifier). The
 * core kinds here used to be registered a SECOND time as "reference
 * handlers" that reimplemented the spec value semantics — two sources of
 * truth that could disagree silently (dead code, but latent: tearing/toxic
 * returned `1` where the spec's read returns `true`; corruption returned the
 * raw value where the spec stringifies — and run() was invoked by no
 * production code). Core now ships no handlers: this registry is empty at
 * import and is filled only by modules that add kinds of their own.
 */

import type { Modifier } from "../../rules-engine/modifier";
import type { ActorView } from "../../ffg/domain/model/actor";
import { collectEffects } from "../../ffg/domain/effects";
import { HandlerRegistry } from "../../ffg/domain/registry";
import { isWeaponType } from "../data/accessors";
import { matchQualityEntry, weaponQualities } from "./weapon-qualities";

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

const handlers = new HandlerRegistry<string, TalentEffectHandler>();

export const talentEffectHandlers = {
	/** Register a handler for an effect kind. Repeat adds to that kind. */
	register(kind: string, handler: TalentEffectHandler): void {
		handlers.on(kind, handler);
	},
	/** Effect kinds with at least one handler. */
	kinds(): string[] {
		return handlers.keys();
	},
	/**
	 * Run every handler registered for the effect's kind; results aggregated
	 * by summation. Unknown kinds are ignored (modules add their own).
	 */
	run(actor: unknown, talent: TalentLike, effect: TalentEffectLike): unknown[] {
		const results: unknown[] = [];
		for (const handler of handlers.for(effect.kind ?? "")) {
			const result = handler(actor, talent, effect);
			if (result !== undefined && result !== null) results.push(result);
		}
		return results;
	},
};

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

/**
 * Parsed roll-mechanic inputs for one attack (bead gci0; registry-shaped by
 * bead gyei).
 *
 * The fields are the mechanics the DAMAGE PIPELINE consumes (adapter.ts
 * applyRollQualityMechanics + toxicActivates), so they stay closed — but the
 * values are no longer populated by a per-quality if/else-if chain: the RT
 * weapon-quality registry (rules/weapon-qualities.ts) populates them, and
 * both entry routes route through it (the printable `special` strings AND
 * the effect kinds, which are one-for-one with the quality slugs).
 * Adding a new roll-changing quality = one registry def (+ a field here only
 * when it carries a NEW mechanic the pipeline must consume).
 */
export interface RollMechanics {
	tearing: boolean;
	toxic: boolean;
	/** Blast rating in metres ("blast-4"), null when the weapon has none. */
	blast: number | null;
}

/**
 * Parse a weapon's `special` strings into roll-mechanic inputs (bead gyei:
 * the old tearing/toxic/blast switch chain is gone — the quality registry in
 * rules/weapon-qualities.ts answers each entry, so a new roll-changing
 * quality registers there and needs no edit here).
 */
export function parseSpecialMechanics(
	special: string[] | undefined,
): RollMechanics {
	const out: RollMechanics = { tearing: false, toxic: false, blast: null };
	const absorb = (parsed: Partial<RollMechanics> | undefined) => {
		if (!parsed) return;
		if (parsed.tearing === true) out.tearing = true;
		if (parsed.toxic === true) out.toxic = true;
		if (
			typeof parsed.blast === "number" &&
			Number.isFinite(parsed.blast)
		)
			// SEMANTIC NOTE (bead gyei review, no behaviour change required):
			// the blast rating absorbs with Math.max across MULTIPLE blast rows,
			// where the OLD parser was last-wins — a bare "blast" entry reset
			// the rating to 0. Shipped data never carries two blast rows on one
			// entry list (one blast row per weapon at most), so the outcomes
			// coincide; Math.max is the sane merge should data ever differ.
			// collectRollMechanicEffects' absorb below mirrors this rule.
			out.blast = Math.max(out.blast ?? 0, parsed.blast);
	};
	for (const entry of special ?? []) {
		// Unregistered qualities are inert without a warning; an unparseable
		// rating on a registered parameterised quality warns and drops loudly
		// (matchQualityEntry, bead dfb8 semantics kept).
		const match = matchQualityEntry(entry);
		if (match) absorb(match.def.mechanics?.(match.rating));
	}
	return out;
}

/**
 * Collect roll-mechanic qualities for an attack (bead gci0; the effect-kind
 * walk routes through the RT quality registry since bead gyei, so BOTH the
 * effect kinds and the weapon's `special` strings resolve from ONE registry
 * — the specs' roll-mechanic kinds (tearing/toxic/blast) are one-for-one
 * with the quality slugs).
 *
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
	// One absorb for BOTH routes: a registry def's Partial<RollMechanics> output
	// (same shape parseSpecialMechanics absorbs through matchQualityEntry).
	const absorb = (parsed: Partial<RollMechanics> | undefined) => {
		if (!parsed) return;
		if (parsed.tearing === true) out.tearing = true;
		if (parsed.toxic === true) out.toxic = true;
		if (
			typeof parsed.blast === "number" &&
			Number.isFinite(parsed.blast)
		)
			out.blast = Math.max(out.blast ?? 0, parsed.blast);
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
		const def = weaponQualities.def(hit.spec.kind);
		if (!def?.mechanics) continue;
		// Rated qualities (blast) read the spec's value; an unrated blast spec
		// (read missing) reaches no mechanic — an unrated rating can never
		// apply. Flag qualities never read (they cannot carry one).
		if (def.rating === "optional") {
			const rating = hit.spec.read?.(hit.item, hit.effect, {
				channel: "roll-mechanic",
			});
			if (typeof rating !== "number") continue;
			absorb(def.mechanics(rating));
		} else {
			absorb(def.mechanics(null));
		}
	}
	const weapon =
		opts.weaponId !== undefined
			? view.items.find((item) => item.id === opts.weaponId)
			: undefined;
	if (weapon?.special.length)
		absorb(parseSpecialMechanics([...weapon.special]));
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
	const out: TargetTraitDamageCollection = {
		tbMultiplier: null,
		reduction: [],
	};
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
