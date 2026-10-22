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

/**
 * Creator-grant clone payload (bead lnya): the pack-doc clone _id strip
 * PLUS the grantedBy provenance stamp (iufv convention) the creators and
 * pickers add so a re-run can reconcile its own previous grants. One shape,
 * three former hand-rolled copies: ship-creator, planet-creator, mod-picker.
 *
 * `doc` is a RESOLVED pack doc (`fromUuid` result or `doc.toObject()`); the
 * returned payload is `createEmbeddedDocuments`-ready (no _id, system
 * spread + grantedBy).
 */
export function grantedClonePayload<
	T extends { _id?: unknown; system?: object | null },
>(
	doc: T,
	grantedBy: string,
): Omit<T, "_id"> {
	const clone = clonePackDocPayload(doc) as Omit<T, "_id"> & {
		system?: object | null;
	};
	return {
		...clone,
		system: {
			...(clone.system ?? {}),
			grantedBy,
		} as NonNullable<T["system"]>,
	};
}