/**
 * Data-driven document registration (bead 6a1x; epic kof0, phase 5).
 *
 * The table lives in bootstrap/sheet-registry.ts; this module turns it into
 * CONFIG.*.dataModels plus the DocumentSheetConfig registrations. Adding a
 * document type is one line in the table.
 *
 * Split out of the sheet/init.ts composition root.
 */

import { registerConfigHelper } from "../sheet/handlebars";
import { systemId } from "./config";
import { SHEET_REGISTRY, type AnySheetCtor } from "./sheet-registry";

/** Register every data model and its sheet. */
export function registerDocumentTypes(): void {
	for (const [type, entry] of Object.entries(SHEET_REGISTRY.Item)) {
		(CONFIG.Item.dataModels as unknown as Record<string, unknown>)[type] =
			entry.model;
	}
	for (const [type, entry] of Object.entries(SHEET_REGISTRY.Actor)) {
		(CONFIG.Actor.dataModels as unknown as Record<string, unknown>)[type] =
			entry.model;
	}
	registerConfigHelper();

	const registerSheet = (
		documentClass:
			| typeof foundry.documents.Item
			| typeof foundry.documents.Actor,
		sheet: AnySheetCtor,
		types: [string, ...string[]],
		label: string,
	) => {
		foundry.applications.apps.DocumentSheetConfig.registerSheet(
			documentClass,
			systemId(),
			sheet as never,
			{ types, makeDefault: true, label },
		);
	};
	for (const documentClass of [
		foundry.documents.Item,
		foundry.documents.Actor,
	] as const) {
		const className = documentClass.name as "Item" | "Actor";
		for (const [type, entry] of Object.entries(SHEET_REGISTRY[className])) {
			if (!entry.sheet) continue;
			registerSheet(
				documentClass,
				entry.sheet,
				[type],
				entry.label ?? `TYPES.${className}.${type}`,
			);
		}
	}
}
