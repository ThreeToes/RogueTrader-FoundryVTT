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

import type { EffectData } from "../data/item/effects";

/** Minimal shape of an owned affliction Item (for grant resolution). */
export interface GrantSourceLike {
	name?: string;
	type?: string;
	system?: { effects?: EffectData[] };
}

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
export function resolveAfflictionGrants(
	items: GrantSourceLike[] | undefined,
): ResolvedGrant[] {
	const seen = new Set<string>();
	const out: ResolvedGrant[] = [];
	for (const item of items ?? []) {
		if (item.type !== "mutation" && item.type !== "madnessentry") continue;
		for (const effect of item.system?.effects ?? []) {
			if (effect.kind !== "grants-item") continue;
			const target = (effect.testKey ?? "").trim();
			const [pack, ...rest] = target.split(":");
			const name = rest.join(":").trim();
			if (!pack || !name) continue;
			const benefit = (effect.label ?? "").trim();
			const key = `${pack}:${name}:${benefit}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ pack, name, benefit, source: item.name ?? "" });
		}
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
}

/** Degenerate Mind (Core p369): the 1d10 sub-roll picks the granted item. */
const DEGENERATE_MIND_TABLE: Array<{ max: number; effect: EffectData }> = [
	{ max: 3, effect: { kind: "grants-item", testKey: "talents:Frenzy" } },
	{ max: 7, effect: { kind: "grants-item", testKey: "talents:Fearless" } },
	{ max: 10, effect: { kind: "grants-item", testKey: "traits:From Beyond" } },
];

/** Mental Regressive (Core p369) rolls independently for each of these. */
const MENTAL_REGRESSIVE_CHARACTERISTICS = ["int", "per", "wp", "fel"];

async function degenerateMind(context: ProcedureContext): Promise<EffectData[]> {
	const rolled = await context.roll("1d10");
	const band = DEGENERATE_MIND_TABLE.find((b) => rolled >= 1 && rolled <= b.max);
	if (!band) {
		throw new Error(
			`Degenerate Mind sub-roll out of range (1d10 returned ${rolled})`,
		);
	}
	return [{ ...band.effect }];
}

async function mentalRegressive(
	context: ProcedureContext,
): Promise<EffectData[]> {
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
	return out;
}

const AFFLICTION_PROCEDURE_HANDLERS: Record<
	string,
	(context: ProcedureContext) => Promise<EffectData[]>
> = {
	"degenerate-mind": degenerateMind,
	"mental-regressive": mentalRegressive,
};

/** Procedure keys with an implementation (test hook). */
export function afflictionProcedureNames(): string[] {
	return Object.keys(AFFLICTION_PROCEDURE_HANDLERS);
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
): Promise<EffectData[]> {
	const key = (procedure ?? "").trim();
	if (!key) return [];
	const handler = AFFLICTION_PROCEDURE_HANDLERS[key];
	if (!handler) {
		throw new Error(`Unknown affliction procedure "${key}"`);
	}
	return handler(context);
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
