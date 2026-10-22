/**
 * Affliction helpers (epic nt8k) — pure, Foundry-free.
 *
 * Afflictions (disorders, malignancies, mutations) are OWNED ITEMS, so their
 * `effects` rows reach the normal item-effects funnel (rules/funnel.ts) and
 * the derived/talent-effect handlers (wounds-max, ...) directly. There is no
 * separate ledger or ledger-to-funnel resolver any more.
 *
 * The one acquisition-time step left is characteristic CHANGES: the book
 * prints them as dice ("reduce its Agility by 1d10"), rolled ONCE when the
 * affliction is acquired and never again. The caller rolls (Foundry) and this
 * pure helper folds the result back into the item's effect row as a settled
 * `value`, so every later test sees a stable number rather than a new roll.
 *
 * Dice expressions are SIGNED: a reduction is authored "-1d10" so the rolled
 * total is already negative. (The first pass of this effect authored a plain
 * "1d10" and therefore ADDED, the opposite of the book — do not regress.)
 */

import type { ActorView } from "../../ffg/domain/model/actor";
import { collectEffects } from "../../ffg/domain/effects";
import type { EffectData } from "../../ffg/domain/model/effect";
import { HandlerRegistry } from "../../ffg/domain/registry";
import { type MutationRow, rollRavagedBody } from "../data/item/mutation-roll";

/** One trait/talent/skill grant carried by an owned affliction. */
export interface ResolvedGrant {
	/** Target compendium pack: "traits" | "talents" | "skills". */
	pack: string;
	/** Item name within that pack. */
	name: string;
	/** Verbatim benefit/rating for a trait ("1", "S×2", "ABx2"); may be "". */
	benefit: string;
	/** Owning affliction's name (chip prefix / tooltip). */
	source: string;
}

/**
 * Item grants carried by owned afflictions (epic nt8k): effects with kind
 * "grants-item" name a target in `testKey` as "<pack>:<item name>" — mirroring
 * the funnel's "skill:<name>" convention — with the verbatim benefit/rating in
 * `label`. Pure; the sheet renders one chip per grant and the click handler
 * resolves the named pack. Duplicates (same pack+name+benefit) collapse so a
 * trait granted by two mutations does not double-chip.
 */
export function resolveAfflictionGrants(view: ActorView): ResolvedGrant[] {
	const seen = new Set<string>();
	const out: ResolvedGrant[] = [];
	for (const hit of collectEffects(view, {
		channel: "acquisition",
		itemWhere: (item) =>
			item.type === "mutation" || item.type === "madnessentry",
	})) {
		if (hit.spec.kind !== "grants-item") continue;
		const payload = hit.spec.read?.(hit.item, hit.effect, {
			channel: "acquisition",
		}) as { target: string; benefit: string } | null;
		if (!payload) continue;
		const [pack, ...rest] = payload.target.split(":");
		const name = rest.join(":").trim();
		if (!pack || !name) continue;
		const benefit = payload.benefit;
		const key = `${pack}:${name}:${benefit}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ pack, name, benefit, source: hit.item.name });
	}
	return out;
}

/**
 * Injection points for acquisition-time procedures (bead xu83). The helpers
 * below stay Foundry-free: the caller supplies the roller and the actor's
 * current characteristic values.
 */
export interface ProcedureContext {
	/** Roll a dice expression once and return its total (e.g. "1d10"). */
	roll: (notation: string) => Promise<number>;
	/** Current base value of a characteristic (for halve / set-to-5 outcomes). */
	characteristic: (key: string) => number;
	/**
	 * Mutation table rows, read lazily from the compendium. Only the
	 * table-rolling procedures need these (Ravaged Body), so the hook is
	 * optional; a procedure that requires it and is not given it THROWS
	 * rather than rolling nothing.
	 */
	mutationRows?: () => Promise<MutationRow[]>;
}

/**
 * An Item a procedure rolled up (bead kam1). The `roll` is kept so the chat
 * card can show the dice, not just the outcome.
 */
export interface ProcedureGrant {
	/** Item name within the mutation pack. */
	name: string;
	/** The d100 that selected this row, when the grant came from a table roll. */
	roll?: number;
}

/**
 * What an acquisition-time procedure produced (bead kam1). A procedure can
 * settle effect rows onto the affliction itself AND/OR name further Items it
 * rolled up from a table; the caller owns resolving and creating those.
 */
export interface ProcedureOutcome {
	/** Settled effect rows for this affliction. */
	effects: EffectData[];
	/**
	 * Further mutations the procedure rolled (Ravaged Body's 1d5 additional
	 * mutations), in roll order. Resolved against the mutation pack by the
	 * caller.
	 */
	grants: ProcedureGrant[];
}

/** Degenerate Mind (Core p369): the 1d10 sub-roll picks the granted item. */
const DEGENERATE_MIND_TABLE: Array<{ max: number; effect: EffectData }> = [
	{ max: 3, effect: { kind: "grants-item", testKey: "talents:Frenzy" } },
	{ max: 7, effect: { kind: "grants-item", testKey: "talents:Fearless" } },
	{ max: 10, effect: { kind: "grants-item", testKey: "traits:From Beyond" } },
];

/** Mental Regressive (Core p369) rolls independently for each of these. */
const MENTAL_REGRESSIVE_CHARACTERISTICS = ["int", "per", "wp", "fel"];

async function degenerateMind(
	context: ProcedureContext,
): Promise<ProcedureOutcome> {
	const rolled = await context.roll("1d10");
	const band = DEGENERATE_MIND_TABLE.find(
		(b) => rolled >= 1 && rolled <= b.max,
	);
	if (!band) {
		throw new Error(
			`Degenerate Mind sub-roll out of range (1d10 returned ${rolled})`,
		);
	}
	return { effects: [{ ...band.effect }], grants: [] };
}

/**
 * Ravaged Body (Core Rulebook p369): "Roll 1d5 times on this table." Unlike
 * the other procedures this one produces further MUTATIONS rather than effect
 * rows, so the rolls come back as grant names for the caller to create.
 */
async function ravagedBody(
	context: ProcedureContext,
): Promise<ProcedureOutcome> {
	if (!context.mutationRows) {
		throw new Error(
			"Ravaged Body needs the mutation table rows (context.mutationRows)",
		);
	}
	const results = await rollRavagedBody(
		await context.mutationRows(),
		context.roll,
		"mutations",
	);
	return {
		effects: [],
		grants: results.map((r) => ({ name: r.name, roll: r.roll })),
	};
}

async function mentalRegressive(
	context: ProcedureContext,
): Promise<ProcedureOutcome> {
	const out: EffectData[] = [];
	for (const key of MENTAL_REGRESSIVE_CHARACTERISTICS) {
		const rolled = await context.roll("1d10");
		if (rolled < 1 || rolled > 10) {
			throw new Error(
				`Mental Regressive sub-roll out of range (1d10 returned ${rolled})`,
			);
		}
		const current = context.characteristic(key);
		// Settle the outcome ONCE against the value at acquisition (the same
		// rolled-once contract as the characteristic-modifier dice): a halve
		// stores the delta that reaches the book's halved value, and a 10
		// stores the delta that lands on 5. 8-9 change nothing.
		let delta: number | null = null;
		if (rolled <= 5) delta = -(await context.roll("1d10"));
		else if (rolled <= 7) delta = Math.floor(current / 2) - current;
		else if (rolled === 10) delta = 5 - current;
		if (delta !== null && delta !== 0) {
			out.push({
				kind: "characteristic-modifier",
				testKey: key,
				value: delta,
				label: "Mental Regressive",
			});
		}
	}
	return { effects: out, grants: [] };
}

/**
 * One registry entry per affliction procedure (bead raf3): label AND behaviour
 * together, replacing the old split where the label-only EntryRegistry lived
 * in registry.ts while this module kept a plain Record of handlers — two maps
 * with no guard asserting key parity.
 *
 * This is a HandlerRegistry (the domain idiom, bead 00z5: reference de-dupe
 * plus off/clear) rather than an EntryRegistry, so modules extending the
 * vocabulary must supply a handler — a label-only registration would be a
 * printed rule with no implementation, which the old shape allowed to drift.
 * Packs name procedures in `system.procedure` as plain strings; the keys here
 * are the pack-data vocabulary and must never be renamed.
 */
export interface AfflictionProcedure {
	/** i18n label key (PROCEDURE.*) for the schema `choices` display. */
	labelKey: string;
	/** Run the acquisition-time roll exactly once. */
	run: (context: ProcedureContext) => Promise<ProcedureOutcome>;
}

export const afflictionProcedures = new HandlerRegistry<
	string,
	AfflictionProcedure
>()
	.on("degenerate-mind", {
		labelKey: "PROCEDURE.DEGENERATE_MIND",
		run: degenerateMind,
	})
	.on("mental-regressive", {
		labelKey: "PROCEDURE.MENTAL_REGRESSIVE",
		run: mentalRegressive,
	})
	// Ravaged Body (Core Rulebook p369) rolls 1d5 further mutations instead of
	// settling rows on itself, so its handler returns grant names (kam1).
	.on("ravaged-body", {
		labelKey: "PROCEDURE.RAVAGED_BODY",
		run: ravagedBody,
	});

/**
 * The schema `choices` shape for `Mutation.system.procedure`: procedure key
 * -> i18n label key. Evaluated at DataModel schema build time (init), so
 * module registrations made during init are captured like any other seed.
 */
export function afflictionProcedureChoices(): Record<string, string> {
	return Object.fromEntries(
		afflictionProcedures.keys().map((key) => [
			key,
			afflictionProcedures.for(key)[0].labelKey,
		]),
	);
}

/** Procedure keys with an implementation (test hook). */
export function afflictionProcedureNames(): string[] {
	return afflictionProcedures.keys();
}

/**
 * Settle a mutation's acquisition-time procedure into concrete effect rows.
 * Pure (Foundry-free): the roller and characteristic reader are injected.
 * Blank returns no rows; an unknown key THROWS rather than silently dropping
 * a printed rule (the items are validated against the registry, so this only
 * fires for hand-edited data).
 */
export async function applyAfflictionProcedure(
	procedure: string | undefined,
	context: ProcedureContext,
): Promise<ProcedureOutcome> {
	const key = (procedure ?? "").trim();
	if (!key) return { effects: [], grants: [] };
	const entry = afflictionProcedures.for(key)[0];
	if (!entry) {
		throw new Error(`Unknown affliction procedure "${key}"`);
	}
	return entry.run(context);
}
export async function resolveEffectValues(
	effects: EffectData[] | undefined,
	roll: (notation: string) => Promise<number>,
): Promise<EffectData[]> {
	const out: EffectData[] = [];
	for (const effect of effects ?? []) {
		if (
			effect.kind !== "characteristic-modifier" ||
			!effect.dice ||
			effect.value
		) {
			out.push(effect);
			continue;
		}
		const rolled = await roll(effect.dice);
		out.push(Number.isFinite(rolled) ? { ...effect, value: rolled } : effect);
	}
	return out;
}
