/**
 * Per-row Ship & Warrant Path choice views (bead twtq): the read-only choice
 * tabs of the dynasty sheet show the PICKED entry's flavour text and
 * mechanics, so the sheet needs one view per chart row resolved against the
 * runtime warrant pool (rules/warrant.ts) — previously the sheet only kept
 * the picker options and never surfaced the chosen entry's prose.
 *
 * Pure helper, Foundry-free (view-models.ts precedent): the caller adapts the
 * canonical rows into its context shape (the dynasty sheet enriches each
 * resolved row's verbatim description via sheet/rich-text and parameterises
 * the shared choice-tab template per row). The row order + labels are the
 * shared WARRANT_ROWS / WARRANT_ROW_LABEL_KEYS; the pool is passed in so the
 * helper stays testable without Foundry.
 */
import {
	WARRANT_ROWS,
	WARRANT_ROW_LABEL_KEYS,
	type WarrantEntry,
	type WarrantRow,
} from "../../rules/warrant";

/** One chart row's read-only choice view (a tabs on the dynasty sheet). */
export interface WarrantChoiceView {
	/** Chart row id (also the tab id). */
	row: WarrantRow;
	/** i18n key of the row's step label (WARRANT.ROW_*). */
	labelKey: string;
	/**
	 * A pick is stored for the row — even when the runtime pool can no longer
	 * resolve it (stale key after a pack revision, or the pack is absent).
	 */
	picked: boolean;
	/** The stored pick key resolves to an entry in the pool. */
	resolved: boolean;
	/** The stored pick key, "" when unpicked. */
	pickKey: string;
	/** Picked entry name ("" when unresolved). */
	name: string;
	/** Verbatim book prose of the picked entry ("" when unresolved). */
	description: string;
	/** Ship Points contribution (null when unresolved). */
	shipPoints: number | null;
	/** Profit Factor contribution (null when unresolved). */
	profitFactor: number | null;
	/** Manual-application mechanics notes (never silently dropped). */
	notes: string[];
	/**
	 * Enriched description HTML — set by the sheet (async enrichment needs
	 * Foundry), "" until then; empty exactly when the row is unresolved.
	 */
	descriptionHTML?: string;
}

/** Structural input: the pool fields the view needs from a WarrantEntry. */
type WarrantEntryLike = Pick<
	WarrantEntry,
	"row" | "key" | "name" | "description" | "mechanics"
>;

/**
 * One view per chart row, in WARRANT_ROWS order. An unpicked row or a pick
 * the pool cannot resolve yields `resolved: false` — the template shows the
 * unpicked hint, never a broken empty tab.
 */
export function warrantChoiceViews(
	picks: Record<string, string>,
	entries: ReadonlyArray<WarrantEntryLike>,
): WarrantChoiceView[] {
	return WARRANT_ROWS.map((row) => {
		const pickKey = picks[row] ?? "";
		const entry = pickKey
			? entries.find((e) => e.row === row && e.key === pickKey)
			: undefined;
		return {
			row,
			labelKey: WARRANT_ROW_LABEL_KEYS[row],
			picked: Boolean(pickKey),
			resolved: Boolean(entry),
			pickKey,
			name: entry?.name ?? "",
			description: entry?.description ?? "",
			shipPoints: entry ? (entry.mechanics.shipPoints ?? null) : null,
			profitFactor: entry ? (entry.mechanics.profitFactor ?? null) : null,
			notes: entry
				? (entry.mechanics.notes ?? []).filter((note) => note !== "")
				: [],
		};
	});
}