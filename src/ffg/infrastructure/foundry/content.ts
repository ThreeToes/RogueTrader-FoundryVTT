/**
 * Foundry implementation of the ContentPort (epic kof0, phase 3; hoisted from
 * src/roguetrader/infrastructure/foundry/content.ts in bead 8ycd so it is
 * system-neutral).
 *
 * Auto-detects the owner's compendiums at call time — no settings. Every lookup
 * is tolerant of absence: a missing pack yields `[]`/`null`, which the rules
 * turn into a manual fallback rather than an error.
 *
 * The RollTables pack id is system DATA, so it comes through the config seam
 * (ports.config.packIds().rolltables) instead of a hard-coded RT constant —
 * the default config reports no rolltables pack and a sibling system overrides
 * it via setConfigOverrides.
 */

import type {
	ContentCapabilities,
	ContentPort,
	ContentTable,
} from "../../application/ports";
import { getPorts } from "./ports";

interface PackLike {
	getDocuments(): Promise<unknown[]>;
	getDocument(id: string): Promise<unknown>;
}

function packGet(packId: string): PackLike | undefined {
	const packs = (
		game as unknown as {
			packs?: { get: (id: string) => PackLike | undefined };
		}
	).packs;
	return packs?.get(packId);
}

/**
 * Every document in a pack, or null when the pack is not installed.
 *
 * The ONE compendium list-fetch primitive (bead s4lu): the ContentPort
 * implementation below and everything behind it read packs through it, so the
 * `game.packs` lookup lives in exactly one place. Callers that want a loud
 * missing-pack warning (the sheet-side pack fetch) distinguish null from an
 * empty pack; the rules-facing ContentPort collapses null to [].
 */
export async function packDocuments(packId: string): Promise<unknown[] | null> {
	const pack = packGet(packId);
	return pack ? await pack.getDocuments() : null;
}

/**
 * The uuid shape the packer stamps and the doc-link library resolves. One
 * document type segment ("Item"); a future Document type would extend the
 * regex, not fork the resolver.
 */
const COMPENDIUM_UUID = /^Compendium\.([^.]+)\.([^.]+)\.Item\.([^.]+)$/;

async function resolveDocument(uuid: string): Promise<unknown | null> {
	const parts = COMPENDIUM_UUID.exec(uuid);
	if (parts) {
		const pack = packGet(`${parts[1]}.${parts[2]}`);
		if (pack) {
			const doc = await pack.getDocument(parts[3]);
			if (!doc) {
				console.warn(
					`rogue-trader | pack document ${parts[3]} not found in ${parts[1]}.${parts[2]}`,
				);
			}
			return doc ?? null;
		}
		console.warn(
			`rogue-trader | compendium pack ${parts[1]}.${parts[2]} not found`,
		);
		return null;
	}
	// fvtt-types types fromUuid's parameter as a template-literal UUID union,
	// but a uuid here is an arbitrary string — cast at this one boundary (the
	// rules/adapter documentFromUuid precedent).
	return (await foundry.utils.fromUuid(uuid as never)) ?? null;
}

function asTable(doc: unknown): ContentTable {
	return doc as ContentTable;
}

/** The rules-facing list view: a missing pack is an empty pack. */
async function documentsOf(packId: string): Promise<unknown[]> {
	return (await packDocuments(packId)) ?? [];
}

export const foundryContent: ContentPort = {
	capabilities(): ContentCapabilities {
		const rolltablesId = getPorts().config.packIds().rolltables;
		const rolltables =
			rolltablesId !== null && packGet(rolltablesId) !== undefined;
		return {
			criticalTables: rolltables,
			phenomenaTables: rolltables,
			// Warmed by bootstrap; when absent the funnel contributor degrades to
			// no modifiers and the player sets them manually.
			originTraits: false,
			skillCatalog: false,
		};
	},
	documents(packId: string): Promise<unknown[]> {
		return documentsOf(packId);
	},
	async documentsOrNull(packId: string): Promise<unknown[] | null> {
		return packDocuments(packId);
	},
	async find(packId: string, name: string): Promise<ContentTable | null> {
		const docs = await documentsOf(packId);
		const found = docs.find((doc) => (doc as { name?: string }).name === name);
		return found ? asTable(found) : null;
	},

	// Sheet-side semantics (bead wwuc root cause), now behind the port: the
	// direct-from-pack resolution must NOT become a generic fromUuid call, or
	// PsychicPicker et al. break again (fromUuid is undefined in-world for our
	// LevelDB comps).
	document(uuid: string): Promise<unknown | null> {
		return resolveDocument(uuid);
	},
};
