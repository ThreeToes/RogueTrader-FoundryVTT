/**
 * Pack-document field readers (epic kof0, bead ptra).
 *
 * The ready-time warmers map compendium documents into typed runtime pools.
 * Every field had to be read defensively — `String(s.key ?? "")`,
 * `Number(s.col ?? 0)`, `s.table ? String(s.table) : undefined` — which made a
 * ~25-line mapping read as coercion rather than as a declaration of the entry
 * being built.
 *
 * These live beside data/accessors.ts for the same reason that module exists:
 * they are the single place the system's assumptions about document SHAPE are
 * written down. They are pure (no Foundry), so they are trivially testable.
 */

/** A document's `system` block, before any shape is assumed. */
export type PackSystem = Record<string, unknown>;

/** The `system` block of a pack document, as a loose record. */
export function packSystem(doc: { system?: unknown }): PackSystem {
	return (doc.system ?? {}) as PackSystem;
}

/** A nested object field (`range`, `grant`, `mechanics`), or an empty record. */
export function nested(source: PackSystem, key: string): PackSystem {
	const value = source[key];
	return (
		typeof value === "object" && value !== null ? value : {}
	) as PackSystem;
}

/** A string field; absent/null becomes the fallback. */
export function str(source: PackSystem, key: string, fallback = ""): string {
	const value = source[key];
	return value === undefined || value === null ? fallback : String(value);
}

/** A finite number field; absent/unparseable becomes the fallback. */
export function num(source: PackSystem, key: string, fallback = 0): number {
	const value = Number(source[key]);
	return Number.isFinite(value) ? value : fallback;
}

/**
 * The first of these keys that is present and non-null, stringified; `""` when
 * none is. This is the `??` chain the warmers used (`description ??
 * shortDescription ?? ""`) made explicit — note it keeps an empty string,
 * because `??` does; use `optionalStr` when absent-and-empty should collapse.
 */
export function firstStr(source: PackSystem, ...keys: string[]): string {
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined && value !== null) return String(value);
	}
	return "";
}

/** A string field that is undefined when absent OR empty. */
export function optionalStr(
	source: PackSystem,
	key: string,
): string | undefined {
	const value = source[key];
	if (value === undefined || value === null || value === "") return undefined;
	return String(value);
}

/** An array-of-strings field; a non-array becomes an empty array. */
export function strArray(source: PackSystem, key: string): string[] {
	const value = source[key];
	return Array.isArray(value) ? value.map(String) : [];
}
