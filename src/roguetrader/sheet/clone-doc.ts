/**
 * Shared pack-document clone-payload helper (bead 27eu): a pack doc's `_id`
 * must NOT ride along into any embedded clone — repo convention, "two Items
 * cannot share an _id" — because dropping the SAME pack entry twice past a
 * uuid-based already-owned check would otherwise clone a duplicate `_id` onto
 * one actor. Relocated from creator-apply.ts (which re-exports it for the
 * xynx call sites); this module is the canonical home so every clone site —
 * creator apply tail, pickers, drop-clone, trait grants — imports one strip.
 */
export function clonePackDocPayload<T extends { _id?: unknown }>(
	payload: T,
): Omit<T, "_id"> {
	const clone = { ...payload } as { _id?: unknown };
	delete clone._id;
	return clone as Omit<T, "_id">;
}