/**
 * Shared pack-doc catalog builders (bead 656m).
 *
 * Two sheet surfaces map the character-option packs into catalog entries:
 * the advancement dialog (`#skillDocs` / `#talentDocs`, richer shapes with
 * uuid + key so rank rows keep their doc links) and the character creator's
 * grant step (`#applyGrantsAndSummary`, a thinner {name, characteristic}[]).
 * Both mappings lived inline and had different shapes, so a catalog-shape
 * change needed two edits and the creator could not gain doc links without
 * duplicating the richer mapping.
 *
 * The builders here USE THE RICHER shape (uuid/key carried on every entry —
 * the doc links keep working) and are PURE: they take the docs, they do not
 * fetch. Callers keep their own fetch strategy (the dialog uses the
 * `characterOptionDocsOnce` session cache; the creator refetches by design).
 */

/** A character-option pack document, as far as the builders read it. */
export interface OptionDocLike {
	id?: string;
	name?: string;
	/** Pack document uuid (bead ha1y row links). */
	uuid?: string;
	system?: {
		key?: string;
		characteristic?: string;
		description?: string;
	};
}

/** Skill catalog entry: display name + key + characteristic + doc link. */
export interface SkillCatalogEntry {
	id: string;
	name: string;
	key: string;
	characteristic: string;
	uuid: string;
}

/** Talent catalog entry: key + name + benefit description + doc link. */
export interface TalentCatalogEntry {
	key: string;
	name: string;
	description: string;
	uuid: string;
}

/**
 * Map the skills pack into richer catalog entries. A doc without a name is
 * skipped (nothing to display or match on); `characteristic` defaults to
 * "int" — the same fallback the advancement dialog's grant path uses.
 */
export function buildSkillCatalog(
	docs: readonly OptionDocLike[],
): SkillCatalogEntry[] {
	const out: SkillCatalogEntry[] = [];
	for (const doc of docs) {
		if (!doc.name) continue;
		out.push({
			id: doc.id ?? "",
			name: doc.name,
			key: doc.system?.key ?? "",
			characteristic: doc.system?.characteristic ?? "int",
			uuid: doc.uuid ?? "",
		});
	}
	return out;
}

/**
 * Map the talents pack into richer catalog entries. A doc without BOTH a
 * name and a system.key is skipped (key-only rows need the key for name
 * resolution; name-only talents carry no description).
 */
export function buildTalentCatalog(
	docs: readonly OptionDocLike[],
): TalentCatalogEntry[] {
	const out: TalentCatalogEntry[] = [];
	for (const doc of docs) {
		if (!doc.name || !doc.system?.key) continue;
		out.push({
			key: doc.system.key,
			name: doc.name,
			description: doc.system.description ?? "",
			uuid: doc.uuid ?? "",
		});
	}
	return out;
}