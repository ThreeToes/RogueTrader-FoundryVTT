/**
 * Composition root — moved to bootstrap/ (epic kof0, phase 5).
 *
 * The 983-line sheetInit() is now five focused modules under bootstrap/, each
 * under ~200 lines. This path is kept as a re-export so the established import
 * (entry-point.ts) keeps working.
 *
 *   bootstrap/config.ts    registries, partials, statuses, extension points, settings
 *   bootstrap/api.ts       the game.rogueTrader.* roll API
 *   bootstrap/sheets.ts    the document-type + sheet registry (bead 6a1x)
 *   bootstrap/warmers.ts   ready-time content caches + legacy-type migration
 *   bootstrap/hooks.ts     actor hooks, chat-button delegation, creator menus
 */

export { sheetInit } from "../bootstrap";
