/**
 * Grant-path helpers (beads meh0, iufv, yclz) — pure, Foundry-free.
 *
 * - meh0: talents granted by the creator/advancement/picker clone the
 *   matching compendium pack document (description, category, effects...)
 *   instead of arriving as bare name-only items.
 * - iufv: creator grants carry provenance (system.grantedBy: "creator");
 *   re-running the creator wipes ALL creator-granted items and re-grants
 *   from the new picks (owner decision 2026-09-05). Manual items (no flag)
 *   are kept.
 * - yclz: parameterised talents ("Peer (X)", "Enemy (X)", ...) prompt for
 *   the parenthetical subject at grant time so "Peer" alone is never
 *   granted (mechanically meaningless without the group).
 */

/** Marker stored on system.grantedBy for items the creator applied. */
export const GRANTED_BY_CREATOR = "creator";

export interface OwnedItemLike {
	id?: string;
	type?: string;
	name?: string;
	system?: { grantedBy?: string };
}

export interface GrantPayload {
	name: string;
	type: "talent" | "skill";
	system: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// yclz — parameterised talents
// ---------------------------------------------------------------------------

/**
 * Parameterised talent bases that MUST take a parenthetical subject. The
 * book (Core Rulebook p92) notes group listings are "representative, not
 * all-inclusive" — suggestions come from groups seen in the rulebook
 * (noble-born Peer list p20; Peer/Enemy rows in the rank tables p102-130),
 * and free text is always allowed.
 */
export const PARAMETERISED_BASES: Readonly<Record<string, string[]>> = {
	Enemy: [
		"Adeptus Arbites",
		"Adeptus Mechanicus",
		"Academics",
		"Ecclesiarchy",
		"Underworld",
	],
	Peer: [
		"Adeptus Arbites",
		"Adeptus Astra Telepathica",
		"Adeptus Mechanicus",
		"Administratum",
		"Astropaths",
		"Ecclesiarchy",
		"Government",
		"Imperial Guard",
		"Imperial Navy",
		"Mercantile",
		"Military",
		"Nobility",
		"Underworld",
		"Workers",
	],
	Hatred: [],
	Resistance: ["Cold", "Fear", "Poison", "Psychic", "Psychic Powers"],
	"Weapon Training": [
		"Basic",
		"Chain",
		"Exotic",
		"Flame",
		"Heavy",
		"Las",
		"Low-Tech",
		"Melee",
		"Pistol",
		"Power",
		"Primitive",
		"Shock",
		"Solid Projectile",
		"SP",
		"Thrown",
		"Universal",
	],
	Talented: [],
	"Forbidden Lore": [
		"Adeptus Mechanicus",
		"Adeptus Arbites",
		"Cults",
		"Heresy",
		"The Warp",
		"Xenos",
	],
};

/** Suggested subjects for a parameterised base (may be empty = free text). */
export function suggestedSubjects(base: string): string[] {
	return PARAMETERISED_BASES[base] ?? [];
}

/**
 * The parameterised base of a talent name, or null when the name is not a
 * parameterised talent. A name is unresolved when it has no parenthetical
 * subject at all ("Peer") or a placeholder one ("Peer (choose one)").
 * Resolved subjects ("Peer (Underworld)") return null.
 */
export function parameterisedBase(name: string): string | null {
	const paren = /^(.+?)\s*\((.+)\)\s*$/.exec(name.trim());
	const base = paren?.[1]?.trim() ?? name.trim();
	if (!(base in PARAMETERISED_BASES)) return null;
	if (!paren) return base;
	const subject = paren[2]?.trim() ?? "";
	if (/^(choose one|any|x)$/i.test(subject)) return base;
	return null;
}

/** Resolve a base + subject into the concrete talent name. */
export function resolveParameterised(base: string, subject: string): string {
	return `${base} (${subject})`;
}

// ---------------------------------------------------------------------------
// meh0 — clone the pack document into the grant payload
// ---------------------------------------------------------------------------

/** Subset of a compendium pack talent doc relevant to granting. */
export interface PackTalentSnapshot {
	name?: string;
	system?: {
		category?: string;
		tier?: number;
		prereqTalent?: string;
		shortDescription?: string;
		description?: string;
		effects?: unknown[];
	};
}

/**
 * Build a talent grant payload cloning the pack document's system fields
 * (description, category, tier, prereqTalent, effects). Bare fallback
 * (empty system) when no pack doc matches; callers log that case.
 * `grantedBy` marks provenance (empty for non-creator paths).
 */
export function talentGrantPayload(
	name: string,
	doc?: PackTalentSnapshot | null,
	options: { grantedBy?: string } = {},
): GrantPayload {
	const source = doc?.system ?? {};
	const system: Record<string, unknown> = {};
	if (source.category !== undefined) system.category = source.category;
	if (source.tier !== undefined) system.tier = source.tier;
	if (source.prereqTalent !== undefined) system.prereqTalent = source.prereqTalent;
	if (source.shortDescription) system.shortDescription = source.shortDescription;
	if (source.description) system.description = source.description;
	if (source.effects && source.effects.length > 0) system.effects = source.effects;
	if (options.grantedBy) system.grantedBy = options.grantedBy;
	return { name, type: "talent", system };
}

/** Skill grant payload with creator provenance (iufv covers all grants). */
export function skillGrantPayload(
	name: string,
	characteristic: string,
	options: { grantedBy?: string } = {},
): GrantPayload {
	const system: Record<string, unknown> = { characteristic, ladder: 1 };
	if (options.grantedBy) system.grantedBy = options.grantedBy;
	return { name, type: "skill", system };
}

// ---------------------------------------------------------------------------
// iufv — creator re-run reconcile
// ---------------------------------------------------------------------------

/**
 * Stored system.origins keys (camelCase, as written by the creator's
 * systemPayload) -> OriginRow keys (kebab-case, ORIGIN_ROWS). Bead h7wl:
 * the legacy-item lookup iterated the stored keys directly against
 * ORIGIN_ROWS, which never matched, so pre-flag creator items were never
 * identified for the wipe.
 */
export const STORED_ORIGIN_KEY_MAP: Readonly<Record<string, string>> = {
	homeWorld: "home-world",
	birthright: "birthright",
	lure: "lure",
	trials: "trials",
	motivation: "motivation",
};

/** Map a stored system.origins key to its OriginRow key, or null. */
export function originRowFromStoredKey(key: string): string | null {
	return STORED_ORIGIN_KEY_MAP[key] ?? null;
}

/** Ids of previously creator-granted items (provenance flag). */
export function creatorGrantIds(existing: OwnedItemLike[]): string[] {
	return existing
		.filter(
			(item) =>
				(item.type === "talent" || item.type === "skill") &&
				item.system?.grantedBy === GRANTED_BY_CREATOR,
		)
		.map((item) => item.id ?? "")
		.filter((id) => id.length > 0);
}

/**
 * Legacy (pre-provenance) creator items: identified by name against the
 * OLD picks' grant names. The first in-place re-run removes these and the
 * re-grant applies the flag (owner decision on iufv).
 */
export function legacyCreatorIds(
	existing: OwnedItemLike[],
	legacyNames: ReadonlySet<string>,
): string[] {
	if (legacyNames.size === 0) return [];
	return existing
		.filter(
			(item) =>
				(item.type === "talent" || item.type === "skill") &&
				item.system?.grantedBy !== GRANTED_BY_CREATOR &&
				item.name !== undefined &&
				legacyNames.has(item.name),
		)
		.map((item) => item.id ?? "")
		.filter((id) => id.length > 0);
}

/**
 * Pure reconcile for the creator apply tail (iufv): given the actor's
 * current items, return the ids to delete (all creator-granted + legacy)
 * and whether re-granting every new grant will be a clean slate.
 */
export function reconcileForCreator(
	existing: OwnedItemLike[],
	legacyNames: ReadonlySet<string>,
): { deleteIds: string[] } {
	return {
		deleteIds: [
			...creatorGrantIds(existing),
			...legacyCreatorIds(existing, legacyNames),
		],
	};
}