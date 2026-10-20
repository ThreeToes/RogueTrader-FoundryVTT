/**
 * The ONE initiative modifier-row collector (bead zl6e).
 *
 * Both initiative routes read this module instead of each walking items with
 * their own rules:
 * • the tracker bulk path — the model's `initiativeBonus` getter (the
 *   @initiativeBonus placeholder resolver, INITIATIVE_FORMULA);
 * • the funnel button path — rollInitiativeAction's dialog contributors.
 *
 * Previously the two copies disagreed: the getter counted guarded rows on
 * every roll, and the funnel filtered contributors by `mod.id.includes(
 * ":initiative:")` — an id-TEXT match against the domain's funnelId format
 * that let a WILDCARD row whose label happens to be "initiative" leak
 * through. Here the match is STRUCTURED (the effect's own `testKey`) and the
 * guard policy is the funnel's: a guarded row counts only when its condition
 * holds (the tracker has no flag context, so guarded rows never count
 * there — tracker and funnel agree by construction instead of by comment).
 *
 * Wildcard rows (`testKey` empty/"any") stay dialog-path modifiers: a bulk
 * formula roll cannot carry them, so they are excluded on BOTH paths and
 * never double-count.
 *
 * Pure: plain shapes in, `Modifier`s out. Both call sites pass their native
 * walk shape (the getter's raw `parent.items` documents carry the fields
 * under `system`; the funnel's `ItemView` carries them flat) — the resolver
 * below accepts both, so no call site maps shapes.
 */
import { effectsAreLive } from "../data/item/effects";
import { funnelModifier } from "../../ffg/domain/effects/specs";
import type { ItemView } from "../../ffg/domain/model/actor";
import type { EffectData } from "../../ffg/domain/model/effect";
import type { Modifier } from "../../rules-engine/index";

/** One effect row: `EffectData` plus the numeric slop of raw documents. */
export interface InitiativeEffectIn {
	kind?: string;
	testKey?: string | null;
	value?: unknown;
	label?: string;
	condition?: string;
}

/**
 * One owned item in EITHER consumer shape: the funnel's flat `ItemView`
 * fields (`equipState`/`effects` at the top), or a raw document with the
 * equip state and effect list under `system`.
 */
export interface InitiativeItemIn {
	id?: string;
	name?: string;
	type?: string;
	equipState?: unknown;
	effects?: unknown;
	system?: { equipState?: unknown; effects?: unknown };
}

/** Effects live on the item? (`effectsAreLive`, same gate the funnel uses.) */
function itemLive(item: InitiativeItemIn): boolean {
	const equipState = item.equipState ?? item.system?.equipState;
	return effectsAreLive(
		item.type === undefined ? undefined : String(item.type),
		typeof equipState === "string" ? equipState : undefined,
	);
}

/** The effect's kind, normalised to the schema default ("test-modifier"). */
function normalisedKind(effect: InitiativeEffectIn): string {
	return effect.kind && effect.kind !== "" ? effect.kind : "test-modifier";
}

/**
 * Collect the initiative-keyed test-modifier rows: live owned items whose
 * explicit `testKey === "initiative"` "test-modifier" effects carry a finite
 * non-zero value, minus guarded rows whose condition flag is not set.
 * Stable order (item order, then effect order) for deterministic
 * breakdowns. A guarded row with `flags` — the condition toggles the dialog
 * offers — counts only when its flag is true.
 */
export function collectInitiativeRows(
	items: Iterable<InitiativeItemIn> | null | undefined,
	flags?: Record<string, boolean>,
): Modifier[] {
	const rows: Modifier[] = [];
	if (!items) return rows;
	for (const item of items) {
		if (!itemLive(item)) continue;
		const effects = ((item.effects ?? item.system?.effects) ??
			[]) as Iterable<InitiativeEffectIn>;
		for (const effect of effects) {
			if (normalisedKind(effect) !== "test-modifier") continue;
			if (effect.testKey !== "initiative") continue; // structured: never id text
			const value = Number(effect.value ?? 0);
			if (!Number.isFinite(value) || value === 0) continue;
			const condition = effect.condition ?? "";
			if (condition && flags?.[condition] !== true) continue;
			// The modifier shape (id/source/label) is the domain's one builder —
			// same ids as any other funnel row, so mergeModifiers dedupes.
			// funnelModifier reads only {type,id,name} + the effect fields, which
			// the plain shapes above carry.
			rows.push(
				funnelModifier(
					item as unknown as ItemView,
					effect as unknown as EffectData,
					"initiative",
				),
			);
		}
	}
	return rows;
}

/** The total the `initiativeBonus` getter folds on top of the Agility Bonus. */
export function sumInitiativeRows(rows: Modifier[]): number {
	return rows.reduce((sum, row) => sum + row.value, 0);
}