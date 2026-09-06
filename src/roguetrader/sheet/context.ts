/**
 * Shared sheet-context plumbing (bead d7js): every sheet's _prepareContext
 * hung arbitrary keys off the RenderContext and cast per file, so the
 * fvtt-types strictness noise (2416/2352/2345) was paid seven times. The
 * cast now lives here once:
 *
 * - `RtActorSheet` / `RtItemSheet` / `RtApplication` — the same
 *   HandlebarsApplicationMixin bases the sheets already extend, with a
 *   _prepareContext override that widens the context to
 *   Record<string, unknown> in one place.
 * - `sheetContext()` — for sheets/dialogs that keep their own base but
 *   need the same widening.
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

/** Widen a base-class context once; the per-sheet casts die here. */
export function sheetContext(context: unknown): Record<string, unknown> {
	return context as Record<string, unknown>;
}

export class RtActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	override async _prepareContext(
		options: object = {},
	): Promise<Record<string, unknown>> {
		return sheetContext(await super._prepareContext(options as never));
	}
}

export class RtItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	override async _prepareContext(
		options: object = {},
	): Promise<Record<string, unknown>> {
		return sheetContext(await super._prepareContext(options as never));
	}
}

export class RtApplication extends HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	override async _prepareContext(
		options: object = {},
	): Promise<Record<string, unknown>> {
		return sheetContext(await super._prepareContext(options as never));
	}
}