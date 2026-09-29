/**
 * Shared DOM helpers for sheets.
 */

/**
 * Read the id of the item row that an action target lives in.
 *
 * Action handlers conventionally ride `data-item-id` on the enclosing row;
 * this centralises that lookup.
 */
export function itemIdFromTarget(
	target: HTMLElement | Element,
): string | null {
	return target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
}