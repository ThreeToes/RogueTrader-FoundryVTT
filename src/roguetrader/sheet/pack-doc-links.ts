/**
 * The pack-doc link library (epic 61pk, bead n2b2): one shared, pure home
 * for the row→pack-doc resolvers the advancement dialog shipped (bead ha1y)
 * and the anchor helper any future surface needs to turn a book-backed name
 * into "one click from its full rules text".
 *
 * TWO layers, one seam:
 * 1. PURE (this file): resolve {key,name} rows against {key,name,uuid}
 *    catalogs — key-first, name-fallback per the existing semantics — and
 *    build the anchor payload ({uuid, name}) + the data-action convention.
 *    Foundry-free by design (bun unit-tests run without a world); the
 *    advancing view model's parity tests ARE the spec (they moved here),
 *    so any behaviour change fails loudly.
 * 2. OPEN (sheet/pack-resolve.ts, NOT duplicated here): resolvePackDocument
 *    + openDocumentSheet turn the anchor's uuid into a read-only sheet.
 *    pack-resolve.ts re-exports this module's pure surface, so an adopter
 *    that also opens sheets imports the whole affordance from one module
 *    ("../pack-resolve"): packDocAnchor, resolvePackDocument and
 *    openDocumentSheet all arrive with that single specifier.
 *
 *    An adopter renders an anchor only when packDocAnchor returns non-null
 *    (unresolvable rows degrade to plain text — never an error):
 *
 *      {{#if link}}<a data-action="{{link.action}}" data-uuid="{{link.uuid}}"
 *          >{{link.name}}</a>{{else}}{{link.name}}{{/if}}
 *
 *    and wires the action to a static handler built on resolvePackDocument
 *    + openDocumentSheet (the advancement dialog's #onOpenPackDoc is the
 *    precedent: loud missing-doc notify, { uuid } toast vars).
 */

// ------------------------------------------------------------------ input shapes

/**
 * The minimal catalog-doc shape the resolvers match against: the pack item's
 * key, display name and (optionally) its compendium uuid. Advancement's
 * PackSkillLike/PackTalentLike, the dialog's enriched catalogs and any
 * future surface's {key, name, uuid} docs all conform — uuid is optional so
 * plain {key, name} fixtures keep working and enrich to an empty uuid.
 */
export interface PackDocLike {
	key: string;
	name: string;
	/** Pack document uuid (bead ha1y) — ""/absent when the caller doesn't link. */
	uuid?: string;
}

/**
 * The minimal row shape: the advance row, a chat-card weapon/power name or a
 * creator pick chip. `type` scopes TYPE-CARRying rows (advance rows) to the
 * right catalog; rows without a type resolve against the SKILL catalog, the
 * same non-talent branch the advancement matcher uses.
 */
export interface DocLinkRowLike {
	key: string;
	name: string;
	/** "talent" resolves against the talent catalog; anything else, skills. */
	type?: string;
}

// ------------------------------------------------------------------- the resolvers

/**
 * The pack talent doc behind a row (bead n2b2, moved verbatim from
 * advancement-view-model.ts): key match first (only when the row has one),
 * then a case-insensitive name match against the catalog display name.
 * Parameterised rows (key + name never equal a real doc, e.g. "Peer
 * (choose one)") match nothing.
 */
export function resolveTalentDoc<T extends PackDocLike>(
	row: DocLinkRowLike,
	talentDocs: T[],
): T | undefined {
	// Empty-name guard (bead e72x B4): "" can never equal a doc name, so skip
	// the full-catalog scan.
	return (
		(row.key ? talentDocs.find((d) => d.key === row.key) : undefined) ??
		(row.name
			? talentDocs.find(
				(d) => d.name.toLowerCase() === row.name.toLowerCase(),
			)
			: undefined)
	);
}

/**
 * The pack skill doc behind a row (bead n2b2, moved verbatim): key match
 * first (only when the row has one), then an EXACT name match against the
 * catalog display name (grant-matcher parity, bead wxkw).
 */
export function resolveSkillDoc<T extends PackDocLike>(
	row: DocLinkRowLike,
	skillDocs: T[],
): T | undefined {
	return (
		(row.key ? skillDocs.find((d) => d.key === row.key) : undefined) ??
		(row.name ? skillDocs.find((d) => d.name === row.name) : undefined)
	);
}

/**
 * The pack document uuid behind a row, for the compendium link (bead ha1y,
 * moved verbatim): shared row→doc resolvers above — talents
 * case-insensitively, skills exactly. Parameterised rows match nothing →
 * "" → plain text in the template. Pure: the uuid is just a string, no
 * Foundry here.
 *
 * Resolution is TYPE-SCOPED (by row.type), deliberately diverging from the
 * name map's "talents first, skills override" single-key scheme (bead e72x
 * B3): a talent row must link to the TALENT doc even if a skill shares its
 * key. Rows WITHOUT a type (chat-card names, creator chips — anything that
 * is not an advance row) take the skill branch; talent surfaces call
 * resolveTalentDoc directly.
 */
export function docLinkUuid(
	row: DocLinkRowLike,
	skillDocs: PackDocLike[],
	talentDocs: PackDocLike[],
): string {
	if (row.type === "talent") {
		return resolveTalentDoc(row, talentDocs)?.uuid ?? "";
	}
	return resolveSkillDoc(row, skillDocs)?.uuid ?? "";
}

// ------------------------------------------------------------- the surface helper

/**
 * The data-action convention every adopter's anchor carries; the dialog
 * action handler reads data-uuid off the event target. Shared as a constant
 * so templates use `{{link.action}}` and the convention cannot drift.
 */
export const OPEN_PACK_DOC_ACTION = "openPackDoc";

/** The anchor payload packDocAnchor hands to a template. */
export interface PackDocAnchor {
	/** The data-action value (OPEN_PACK_DOC_ACTION). */
	action: string;
	/** The resolved pack document uuid — non-empty when this anchor exists. */
	uuid: string;
	/** The name the anchor renders (the row's display name, verbatim). */
	name: string;
}

/**
 * Anchor-ready payload (epic 61pk): THE one-helper-call adoption surface.
 * Pass the catalogs + the row, get the {action, uuid, name} an anchor
 * renders — or null when the row has no pack doc (unresolvable keys,
 * parameterised talents, hand-made items), meaning: render plain text,
 * never error. The uuid is the same docLinkUuid stamp the advancement
 * dialog's rows carry (bead ha1y), so every surface links through the one
 * resolution path.
 */
export function packDocAnchor(
	row: DocLinkRowLike,
	skillDocs: PackDocLike[],
	talentDocs: PackDocLike[],
	displayName?: string,
): PackDocAnchor | null {
	const uuid = docLinkUuid(row, skillDocs, talentDocs);
	if (!uuid) return null;
	return { action: OPEN_PACK_DOC_ACTION, uuid, name: displayName ?? row.name };
}

