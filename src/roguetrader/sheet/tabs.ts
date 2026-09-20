/**
 * Shared tab configurations (epic kof0, bead rt9z).
 *
 * Two reasons this exists:
 *
 * 1. Five item sheets declared the same two-tab layout independently — four of
 *    them byte-for-byte identical (data + notes, initial "data"). One
 *    definition instead of five.
 * 2. fvtt-types' `Tab` requires `cssClass`, which all 27 tab entries in the
 *    tree were missing. That is a static-side mismatch on every sheet class
 *    (TS2417), so it is fixed here once for the shared layouts.
 *
 * `cssClass` is Foundry's extra-classes hook on the tab button; the empty
 * string is the default. The entries deliberately do NOT carry `group`:
 * fvtt-types' `TabsConfiguration.tabs` is `Omit<Tab, "group" | "active">[]`,
 * because the group is the OUTER key of this record, not a per-tab field.
 * (Annotating the constant is what surfaced that — the entries had a redundant
 * `group: "primary"` that nothing read.)
 *
 * The explicit `TabsConfiguration` annotations matter: leaving these to
 * inference makes the tab literal type deep enough that the ApplicationV2
 * mixin reports TS2589 ("type instantiation is excessively deep") on every
 * sheet declaring TABS, and is what makes `tsc` take ~40s per sheet.
 * Measured: sheets WITHOUT `static TABS` are TS2589-free; every sheet with it
 * is not. Naming the shape keeps inference shallow.
 */

/** data + notes — the standard item sheet layout. */
export const ITEM_DATA_TABS: Record<
	string,
	foundry.applications.api.ApplicationV2.TabsConfiguration
> = {
	primary: {
		tabs: [
			{ id: "data", label: "TAB.DATA", cssClass: "" },
			{ id: "notes", label: "TAB.DESCRIPTION", cssClass: "" },
		],
		initial: "data",
	},
};

/** description + data — the career sheet leads with its prose. */
export const ITEM_DESCRIPTION_TABS: Record<
	string,
	foundry.applications.api.ApplicationV2.TabsConfiguration
> = {
	primary: {
		tabs: [
			{ id: "description", label: "TAB.DESCRIPTION", cssClass: "" },
			{ id: "data", label: "TAB.DATA", cssClass: "" },
		],
		initial: "description",
	},
};
