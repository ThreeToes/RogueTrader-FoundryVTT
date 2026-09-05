/**
 * Origin traits (bead tgq9): runtime resolution of the traits attached to a
 * character's Origin Path picks. Definitions come from the
 * rogue-trader.origintraits compendium (cached at init, see sheet/init.ts);
 * the cache seam keeps the funnel contributor synchronous.
 *
 * Decisions (owner-approved):
 * - Traits derive at runtime from system.origins picks; only CLAIM state for
 *   grants persists on the actor (system.origins.claims).
 * - Modifiers feed the funnel via the "origin-traits" contributor; Fel-keyed
 *   Interaction approximations are VERIFY-flagged in the pack text.
 * - Notes never disappear: they render on the Background tab.
 */

export interface OriginTraitDef {
	name: string;
	originKey: string;
	traitKey: string;
	kind: "modifier" | "grant" | "note";
	testKey: string;
	value: number;
	grantKind: string;
	text: string;
}

/** Lookup key: originKey.traitKey. */
export function traitDefKey(def: Pick<OriginTraitDef, "originKey" | "traitKey">): string {
	return `${def.originKey}.${def.traitKey}`;
}

/** Minimal shape of Character.system.origins. */
export interface OriginsRecord {
	homeWorld?: string;
	birthright?: string;
	lure?: string;
	trials?: string;
	motivation?: string;
	claims?: Record<string, boolean>;
}

/** Extract the origin entry key from a stored pick ("key" or "key|variant"). */
export function pickOriginKey(stored: string | undefined): string | null {
	if (!stored) return null;
	return stored.split("|")[0] ?? null;
}

/** A resolved trait for one character. */
export interface ResolvedOriginTrait {
	def: OriginTraitDef;
	/** Grant claim state (kind "grant" only). */
	claimed: boolean;
}

/**
 * Resolve the trait definitions for a character's picks. Pure: takes the
 * origins record and the definition list (cached pack + registry entries).
 * Unknown picks (no defs) resolve to nothing — the pack is the source.
 */
export function resolveOriginTraits(
	origins: OriginsRecord | undefined,
	defs: OriginTraitDef[],
): { modifiers: ResolvedOriginTrait[]; grants: ResolvedOriginTrait[]; notes: ResolvedOriginTrait[] } {
	const out = { modifiers: [], grants: [], notes: [] } as {
		modifiers: ResolvedOriginTrait[];
		grants: ResolvedOriginTrait[];
		notes: ResolvedOriginTrait[];
	};
	if (!origins) return out;
	const activeKeys = new Set(
		[
			origins.homeWorld,
			origins.birthright,
			origins.lure,
			origins.trials,
			origins.motivation,
		]
			.map(pickOriginKey)
			.filter((k): k is string => Boolean(k)),
	);
	const claims = origins.claims ?? {};
	for (const def of defs) {
		if (!activeKeys.has(def.originKey)) continue;
		const resolved = {
			def,
			claimed: def.kind === "grant" && (claims[traitDefKey(def)] === true),
		};
		if (def.kind === "modifier") out.modifiers.push(resolved);
		else if (def.kind === "grant") out.grants.push(resolved);
		else out.notes.push(resolved);
	}
	return out;
}

/** Stable modifier id for one trait (additive across traits). */
export function traitModifierId(def: OriginTraitDef): string {
	return `origin-trait:${traitDefKey(def)}:${def.testKey || "any"}:${def.value}`;
}