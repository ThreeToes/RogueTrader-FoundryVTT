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
 * Effects with `characteristic-modifier` dice resolved into `value`. Pure: the
 * roller is injected. Rows that already carry a value are left untouched, and
 * the `dice` expression is kept for display ("Agility -1d10"); `value` shows
 * the settled roll. Order is preserved.
 */
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
