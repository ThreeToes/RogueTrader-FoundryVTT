/**
 * Affliction mechanical effects (bead jy4o) — pure, Foundry-free.
 *
 * Acquired afflictions live on the actor LEDGER (system.afflictions:
 * kind/name/severity/text — the audit trail). Their mechanical payload lives
 * on the SOURCE pack entry (madness disorders/malignancies + the mutations
 * table, epic 1g2t) as `effects` rows. This module resolves a ledger entry to
 * its pack def by (kind, name) and turns the def's test-modifier effects into
 * funnel `Modifier`s, so content stays in the packs and no name->modifier
 * table lives in code.
 *
 * Characteristic-CHANGE effects (e.g. "-1d10 Agility") and trait/gear grants
 * are NOT test modifiers — they need their own machinery (follow-up bead);
 * their verbatim text stays on the ledger entry, so nothing is silent.
 *
 * The mapping mirrors the funnel's "item-effects" contributor: kind
 * "test-modifier" (or "attack-modifier" on attack tests), testKey "" =
 * wildcard / "skill:<name>" = a named skill test / a characteristic key, and
 * an optional `condition` gate on a context flag. Pure; the funnel
 * contributor passes the cached defs (CONFIG.ROGUE_TRADER.afflictions).
 */

import type { Modifier } from "../../rules-engine/src/modifier";
import type { EffectData } from "../data/item/effects";

export type AfflictionKind = "disorder" | "malignancy" | "mutation";

/** One pack-authored affliction; the ledger matches it by (kind, name). */
export interface AfflictionDef {
	kind: AfflictionKind;
	name: string;
	/** Effect rows authored on the pack entry. */
	effects: EffectData[];
	/** Verbatim book text (sheet/audit; never dropped). */
	text: string;
}

/** Minimal ledger shapes (Character.system.afflictions entries). */
export interface AfflictionEntryLike {
	kind?: string;
	name?: string;
	/** Characteristic changes resolved at acquisition (dice already rolled). */
	characteristics?: Array<{ key?: string; value?: number }>;
}

/** Minimal test context the funnel passes contributors. */
export interface AfflictionTestContext {
	kind: string;
	key: string;
	skillName?: string;
	flags?: Record<string, boolean>;
}

/** Lookup key for a def/ledger entry. */
export function afflictionKey(kind: string, name: string): string {
	return `${kind}:${name}`;
}

/** Index defs by `${kind}:${name}` for O(1) ledger resolution. */
export function indexAfflictionDefs(
	defs: AfflictionDef[],
): Map<string, AfflictionDef> {
	return new Map(defs.map((def) => [afflictionKey(def.kind, def.name), def]));
}

/** Whether a test-modifier effect applies to the context's test. */
function effectApplies(
	effect: EffectData,
	context: AfflictionTestContext,
): boolean {
	const kind = effect.kind;
	const isTestModifier =
		kind === undefined || kind === "" || kind === "test-modifier";
	const isAttackModifier = kind === "attack-modifier" && context.kind === "attack";
	if (!isTestModifier && !isAttackModifier) return false;
	const key = effect.testKey;
	if (key?.startsWith("skill:")) {
		return (
			context.skillName?.toLowerCase() ===
			key.slice("skill:".length).toLowerCase()
		);
	}
	if (key !== "" && key !== undefined && key !== context.key) return false;
	if (effect.condition && !context.flags?.[effect.condition]) return false;
	return true;
}

/**
 * Resolve an affliction's `characteristic-modifier` effects into concrete
 * deltas for a ledger entry. Dice (`1d10`, `2d10`, `1d5`) are rolled ONCE here
 * (at acquisition, per the book) via the caller's roller, then persisted on the
 * ledger — later tests must see a stable number, never a fresh roll. Async so
 * the Foundry roller can be awaited; pure (no Foundry import).
 */
export async function resolveCharacteristicChanges(
	effects: EffectData[] | undefined,
	roll: (notation: string) => Promise<number>,
): Promise<Array<{ key: string; value: number }>> {
	const out: Array<{ key: string; value: number }> = [];
	for (const effect of effects ?? []) {
		if (effect.kind !== "characteristic-modifier") continue;
		const key = (effect.testKey ?? "").trim();
		if (!key) continue;
		const value = effect.dice ? await roll(effect.dice) : Number(effect.value ?? 0);
		if (!Number.isFinite(value) || value === 0) continue;
		out.push({ key, value });
	}
	return out;
}

/**
 * Test modifiers contributed by the actor's affliction ledger:
 * - `test-modifier` / `attack-modifier` effects authored on the pack entry
 *   (resolved by (kind, name));
 * - resolved CHARACTERISTIC changes stored on the ledger entry, emitted when
 *   the test's characteristic key matches, so a -10 Weapon Skill shows in
 *   every WS test/skill/attack breakdown.
 * Ids are stable and sourced by affliction, so two afflictions contributing
 * the same value stay additive (the item-effects dedupe lesson). Unknown
 * ledger entries contribute nothing.
 */
export function resolveAfflictionModifiers(
	ledger: AfflictionEntryLike[] | undefined,
	defs: AfflictionDef[],
	context: AfflictionTestContext,
): Modifier[] {
	if (!ledger || ledger.length === 0) return [];
	const byKey = indexAfflictionDefs(defs);
	const mods: Modifier[] = [];
	for (const entry of ledger) {
		if (entry.kind && entry.name) {
			const def = byKey.get(afflictionKey(entry.kind, entry.name));
			for (const effect of def?.effects ?? []) {
				if (!effectApplies(effect, context)) continue;
				const value = Number(effect.value);
				if (!Number.isFinite(value) || value === 0) continue;
				mods.push({
					id: `affliction:${def?.kind}:${def?.name}:${effect.testKey || "any"}:${effect.label ?? ""}:${effect.condition || "any"}`,
					source: { type: "item", label: "SOURCE.FROM_AFFLICTIONS" },
					label: effect.label || def?.name || "",
					value,
					...(effect.condition ? { condition: effect.condition } : {}),
				});
			}
		}
		for (const delta of entry.characteristics ?? []) {
			const key = delta.key ?? "";
			const value = Number(delta.value ?? 0);
			if (!key || !Number.isFinite(value) || value === 0) continue;
			if (key !== context.key) continue;
			mods.push({
				id: `affliction:characteristic:${entry.kind ?? ""}:${entry.name ?? ""}:${key}`,
				source: { type: "item", label: "SOURCE.FROM_AFFLICTIONS" },
				label: entry.name ?? "",
				value,
			});
		}
	}
	return mods;
}
