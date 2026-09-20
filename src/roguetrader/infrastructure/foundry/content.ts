/**
 * Foundry implementation of the ContentPort (epic kof0, phase 3).
 *
 * Auto-detects the owner's compendiums at call time — no settings. Every lookup
 * is tolerant of absence: a missing pack yields `[]`/`null`, which the rules
 * turn into a manual fallback rather than an error.
 */

import type {
	ContentCapabilities,
	ContentPort,
	ContentTable,
} from "../../application/ports";
import { ROLLTABLES_PACK } from "../../application/packs";

interface PackLike {
	getDocuments(): Promise<unknown[]>;
}

function packGet(packId: string): PackLike | undefined {
	const packs = (
		game as unknown as {
			packs?: { get: (id: string) => PackLike | undefined };
		}
	).packs;
	return packs?.get(packId);
}

function asTable(doc: unknown): ContentTable {
	return doc as ContentTable;
}

export const foundryContent: ContentPort = {
	capabilities(): ContentCapabilities {
		const rolltables = packGet(ROLLTABLES_PACK) !== undefined;
		return {
			criticalTables: rolltables,
			phenomenaTables: rolltables,
			// Warmed by bootstrap; when absent the funnel contributor degrades to
			// no modifiers and the player sets them manually.
			originTraits: false,
			skillCatalog: false,
		};
	},
	async documents(packId: string): Promise<unknown[]> {
		const pack = packGet(packId);
		return pack ? pack.getDocuments() : [];
	},
	async find(packId: string, name: string): Promise<ContentTable | null> {
		const docs = await foundryContent.documents(packId);
		const found = docs.find(
			(doc) => (doc as { name?: string }).name === name,
		);
		return found ? asTable(found) : null;
	},
};
