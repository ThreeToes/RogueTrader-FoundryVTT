/**
 * Compatibility shim (bead 8ycd): the Foundry ContentPort implementation
 * hoisted to src/ffg/infrastructure/foundry/content.ts, system-neutral (the
 * RollTables pack id now arrives through ports.config.packIds(), registered by
 * the ports shim). This module keeps the existing imports working.
 */

export { foundryContent, packDocuments } from "../../../ffg/infrastructure/foundry/content";