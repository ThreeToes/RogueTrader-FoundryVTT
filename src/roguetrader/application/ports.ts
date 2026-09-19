/**
 * Ports (epic kof0, phase 3): the boundary between the rules and Foundry.
 *
 * The rules take these as plain values, so they can run headlessly in tests and
 * so the system can degrade gracefully when content is missing. This file grows
 * one port at a time as the adapters are migrated; `ContentPort` is first
 * because content-optional is the load-bearing requirement.
 *
 * CONTENT-OPTIONAL PRINCIPLE (owner, 2026-09):
 *   Manual entry is the baseline. With no compendium content a player rolls the
 *   base target and sets modifiers by hand in the TestDialog. Installing the
 *   content only ADDS automation (auto-collected modifiers, table lookups) — it
 *   never gates a roll and its absence never produces a broken or silent card.
 */

/** Which content the world has installed (cheap to probe; no doc loading). */
export interface ContentCapabilities {
	/** The critical-hit RollTables (core + battlesuit) are installed. */
	criticalTables: boolean;
	/** The Psychic Phenomena / Perils tables are installed. */
	phenomenaTables: boolean;
	/** Origin-trait definitions are warmed (the funnel contributor). */
	originTraits: boolean;
	/** The skill catalog is warmed (createActor grants). */
	skillCatalog: boolean;
}

/** The "no compendiums installed" default: everything falls back to manual. */
export const NO_CONTENT: ContentCapabilities = {
	criticalTables: false,
	phenomenaTables: false,
	originTraits: false,
	skillCatalog: false,
};

/** One RollTable-shaped document, as far as the rules read it. */
export interface ContentTable {
	name?: string;
	formula?: string;
	results?: Iterable<{ text?: string; range?: [number, number] }>;
}

/** Read-only access to compendium content, tolerant of absence. */
export interface ContentPort {
	/** Cheap capability probe (no document loading). */
	capabilities(): ContentCapabilities;
	/** Every document in a pack; empty when the pack is absent. */
	documents(packId: string): Promise<unknown[]>;
	/** One document by name; null when the pack or document is absent. */
	find(packId: string, name: string): Promise<ContentTable | null>;
}

/** The port used when no content provider has been wired (tests, headless). */
export const NO_CONTENT_PORT: ContentPort = {
	capabilities: () => NO_CONTENT,
	documents: async () => [],
	find: async () => null,
};
