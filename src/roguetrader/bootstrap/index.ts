/**
 * The composition root (epic kof0, phase 5).
 *
 * sheet/init.ts used to be a single 983-line `sheetInit()` holding config,
 * document registration, content warmers, runtime hooks and the public API.
 * It is now five focused modules, each under ~200 lines:
 *
 *   bootstrap/config.ts    registries, partials, statuses, extension points, settings
 *   bootstrap/api.ts       the game.rogueTrader.* roll API
 *   bootstrap/sheets.ts    the document-type + sheet registry (bead 6a1x)
 *   bootstrap/warmers.ts   ready-time content caches + legacy-type migration
 *   bootstrap/hooks.ts     actor hooks, chat-button delegation, creator menus
 *
 * Everything still hangs off the single `init` hook, so boot order is
 * unchanged: config first (DataModel schemas read it), then document types,
 * then the warmers and runtime hooks.
 */

import { registerRollApi } from "./api";
import { registerSystemConfig } from "./config";
import { registerRuntimeHooks } from "./hooks";
import { registerDocumentTypes } from "./sheets";
import { registerContentWarmers } from "./warmers";

/** Wire the system into Foundry. Called once from entry-point.ts. */
export function sheetInit(): void {
	Hooks.once("init", () => {
		registerSystemConfig();
		registerRollApi();
		registerDocumentTypes();
		registerContentWarmers();
		registerRuntimeHooks();
	});
}
