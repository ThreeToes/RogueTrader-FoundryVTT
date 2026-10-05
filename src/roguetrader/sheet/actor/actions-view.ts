/**
 * ACTIONS tab view model + chip click (epic moew, bead 9r82): the sheet-side
 * surface over rules/actions.ts. Two pieces:
 *
 * - `actionChipRows` — the tab context: the warmed catalog (Table 9-4, book
 *   order) evaluated against the actor's capabilities, one chip row each with
 *   the availability grey-state and a composed tooltip. The localiser is a
 *   parameter so the composition stays unit-testable (the
 *   buildCharacteristicViews precedent).
 * - `combatActionChipAction` — the shared click body (the openPackItemAction
 *   `this`-style): an action WITHOUT a printed roll posts the lookup chat
 *   card; an action WITH one is child 3's work (bead et5a) and is a
 *   deliberate stub until that wiring lands.
 */
import type { ActionOwnedItem } from "../../rules/actions";
import {
	actionAvailable,
	actionCapabilities,
	ensureActionCatalog,
	postActionLookupCard,
	type ActionCapabilities,
	type ActionEntry,
} from "../../rules/actions";
import { getPackDocuments, packDocsOnce } from "../pack-resolve";

/** The actions concept pack (manifest-packs.yaml, bead moew child 1). */
export const ACTIONS_PACK = "rogue-trader.actions";

/**
 * Memoized pack fetch for the catalog's on-demand pre-ready fill (bead j4io's
 * once-cache): the ready warmer holds the steady-state pool, this only covers
 * a sheet opened before ready.
 */
export function actionCatalogLoader(): Promise<unknown[]> {
	return packDocsOnce(ACTIONS_PACK, () => getPackDocuments(ACTIONS_PACK));
}

/** One chip row on the tab (the skills screen's row anatomy, 2-col grid). */
export interface ActionChipRow {
	name: string;
	/** The pack document uuid the lookup card links ("" degrades to text). */
	uuid: string;
	/** Printed cost + the Varies note when one exists: "Half/Full", "Varies (…)" */
	cost: string;
	/** The action prints a test (child 3's roll wiring, bead et5a). */
	hasRoll: boolean;
	/** Prerequisites met — FALSE greys the chip (visible, never locked). */
	available: boolean;
	/** Pre-composed data-tooltip (server-side localisation, no hbs concat). */
	tooltip: string;
}

/**
 * Chip rows in BOOK order (Table 9-4's printed row order — the pack preserves
 * it and the tab is the table's sheet face, so no alphabetical re-sort here).
 * Available chips tooltip the printed terse line; unmet ones lead with the
 * PREREQ_UNMET hint + the printed prerequisite sentence.
 */
export function actionChipRows(
	entries: ActionEntry[],
	caps: ActionCapabilities,
	localize: (key: string) => string,
): ActionChipRow[] {
	return entries.map((entry) => {
		const available = actionAvailable(entry, caps);
		const tooltip = available
			? entry.shortDescription
			: `${localize("ACTION.PREREQ_UNMET")} ${entry.prerequisites}`.trim();
		return {
			name: entry.name,
			uuid: entry.uuid,
			cost: entry.actionNote
				? `${entry.actionCost} (${entry.actionNote})`
				: entry.actionCost,
			hasRoll: entry.rollTest !== "",
			available,
			// Roll-spec chips are child 3's wiring (bead et5a): flag the stub in
			// the tooltip so a click that does nothing is NOT a mystery.
			tooltip:
				tooltip +
				(entry.rollTest !== "" ? ` — ${localize("ACTION.ROLL_PENDING")}` : ""),
		};
	});
}

/**
 * The tab's context rows: ensure the catalog (pool-first), compute the
 * capabilities ONCE over the actor's owned items, evaluate every entry.
 */
export async function actionsChipContext(
	items: ActionOwnedItem[],
	localize: (key: string) => string,
): Promise<ActionChipRow[]> {
	const entries = await ensureActionCatalog(actionCatalogLoader);
	return actionChipRows(entries, actionCapabilities(items), localize);
}

/**
 * Chip click body (data-action="combatAction"): lookup cards for unrolled
 * actions, the et5a stub for roll-spec ones.
 */
export async function combatActionChipAction(
	this: { actor: foundry.documents.Actor },
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const name = target.dataset.actionName ?? "";
	if (target.dataset.hasRoll === "true") {
		// Bead et5a (child 3 of moew): roll-spec actions route through the roll
		// pipeline (test/difficulty from the entry, opposed rolls manual per the
		// owner). Not wired yet — deliberate stub, flagged in the chip tooltip.
		return;
	}
	if (!name) return;
	const entries = await ensureActionCatalog(actionCatalogLoader);
	const entry = entries.find((candidate) => candidate.name === name);
	if (!entry) {
		// The chip was rendered from an entry now missing from the catalog:
		// loud, not silent (the card would otherwise post a dead link).
		console.warn(
			`rogue-trader | actions tab: chip "${name}" did not resolve to a pack action`,
		);
		return;
	}
	// The card carries the action NAME as the compendium doc link, the action
	// cost and the book's terse line — the full prose is one click away through
	// the linked doc.
	await postActionLookupCard({
		actor: this.actor,
		entry,
		labels: {
			cost: game.i18n!.localize("ACTION.COST"),
			description: game.i18n!.localize("ACTION.DESCRIPTION"),
		},
	});
}