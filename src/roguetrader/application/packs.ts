/**
 * Compendium pack ids the rules address through the ContentPort (epic kof0,
 * bead oi59).
 *
 * These are DATA, not adapters, so they live beside the port they are
 * arguments to rather than in infrastructure/foundry: importing the Foundry
 * content module just to get a string misrepresents the dependency.
 *
 * One id, one name. The critical-hit tables and the Psychic Phenomena tables
 * share a pack, and that id used to be declared TWICE — as
 * CRITICAL_ROLLTABLES_PACK in rules/criticals.ts and ROLLTABLES_PACK in
 * infrastructure/foundry/content.ts — with nothing linking them. Editing one
 * would have silently split the capability probe from the table lookup.
 */

/** RollTables: critical-hit charts (core + battlesuit) and phenomena/perils. */
export const ROLLTABLES_PACK = "rogue-trader.rolltables";
