/**
 * Shared sheet-context plumbing (bead d7js; resolved by beads rt9z + e2ge).
 *
 * Every sheet's `_prepareContext` hangs its own keys off the RenderContext, and
 * fvtt-types types that context as the document sheet's `RenderContext`, which
 * does not have them. `sheetContext()` performs that one widening, so the cast
 * appears once per sheet instead of once per key.
 *
 * WHY THERE IS NO SHARED BASE CLASS HERE ANY MORE (bead e2ge)
 * ----------------------------------------------------------
 * There used to be `RtActorSheet` / `RtItemSheet` / `RtApplication`: mixin
 * bases whose `_prepareContext` returned `Promise<Record<string, unknown>>` so
 * subclasses could add keys without a cast. They were retired because that
 * return type does not satisfy the base's `Promise<RenderContext>` (TS2416),
 * and every attempt to fix it is worse. Measured on this file alone:
 *
 *   return `Promise<Record<string, unknown>>`              1.3s, 2x TS2416
 *   return `Promise<ActorSheetV2.RenderContext>`           OOM, 4GB, ~95s
 *   return `ActorSheetV2.RenderContext & Record<string, …>` OOM, 4GB, ~95s
 *   drop the override entirely (empty subclasses)          OOM, 4GB, ~95s
 *
 * Naming the document sheet's `RenderContext` anywhere in that hierarchy makes
 * tsc non-terminating (the same non-termination that surfaces as TS2589). So a
 * type-correct shared base is not achievable with this fvtt-types version, and
 * a base that lies about its return type is not worth keeping: a cast in a
 * METHOD BODY costs the resolver nothing, and that is what `sheetContext` is.
 *
 * Sheets therefore extend the Foundry mixin directly:
 *
 *   const context = sheetContext(await super._prepareContext(options));
 *   context.myKey = …;
 */

import { effectEditorChoices } from "./item/effect-actions";
import { itemDescriptionHTML } from "./rich-text";

/** Widen a base-class context so a sheet can hang its own keys off it. */
export function sheetContext(context: unknown): Record<string, unknown> {
	return context as Record<string, unknown>;
}

/**
 * The item-sheet data keys every item sheet composes (bead apxq):
 * the enriched description tab prose plus the shared effect editor's
 * dropdown choices (kind labels + test keys, bead bpd).
 */
export interface ItemDataKeys {
	descriptionHTML: string;
	kindChoices: Record<string, string>;
	testKeyChoices: Record<string, string>;
}

/**
 * One composition helper for the boilerplate every item sheet would
 * otherwise hand-wire. There is no shared item-sheet base class (see above),
 * so sheets compose instead:
 *
 *   const context = sheetContext(await super._prepareContext(options));
 *   Object.assign(context, await itemDataContext(this.document));
 *
 * NOTE: tab preparation stays per-sheet (only some sheets render tab
 * partials, and HandlebarsApplicationMixin shapes `context.tabs` itself);
 * this helper only covers the keys that are genuinely uniform.
 */
export async function itemDataContext(
	document: unknown,
): Promise<ItemDataKeys> {
	return {
		descriptionHTML: await itemDescriptionHTML(document),
		...effectEditorChoices(),
	};
}
