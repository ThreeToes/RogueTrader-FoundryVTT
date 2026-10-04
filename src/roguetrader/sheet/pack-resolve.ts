/**
 * Robust compendium document resolution (bead wwuc root cause): fromUuid
 * resolved to undefined in-world for our LevelDB packs even when the pack
 * held the document, silently no-opping `item.sheet?.render(...)`. Resolve
 * the document DIRECTLY from the pack instead:
 * "Compendium.<pack>.<type>.<id>" -> game.packs.get("<pack>").getDocument(id).
 * fromUuid stays the fallback for non-compendium uuid shapes.
 */
import { getPorts } from "../../ffg/infrastructure/foundry/ports";
import { packDocuments } from "../infrastructure/foundry/content";
/**
 * The OPEN layer of the pack-doc link library (epic 61pk, bead n2b2):
 * this module pairs the pure resolvers/anchor helper (sheet/pack-doc-links.ts,
 * Foundry-free) with the Foundry-coupled open path below — one import point
 * for adopters, no duplicated resolver definitions. Adopters that need only
 * resolution (no opening, e.g. pure view models) import pack-doc-links
 * directly; adopters that open sheets import here.
 */
export {
	docLinkUuid,
	packDocAnchor,
	resolveSkillDoc,
	resolveTalentDoc,
	OPEN_PACK_DOC_ACTION,
	type PackDocAnchor,
	type PackDocLike,
	type DocLinkRowLike,
} from "./pack-doc-links";
export async function resolvePackDocument(
	uuid: string,
): Promise<unknown | null> {
	const parts = /^Compendium\.([^.]+)\.([^.]+)\.Item\.([^.]+)$/.exec(uuid);
	if (parts) {
		const pack = game.packs?.get(`${parts[1]}.${parts[2]}`);
		if (pack) {
			const doc = await (
				pack as unknown as {
					getDocument: (id: string) => Promise<unknown>;
				}
			).getDocument(parts[3]);
			if (!doc) {
				console.warn(
					`rogue-trader | pack document ${parts[3]} not found in ${parts[1]}.${parts[2]}`,
				);
			}
			return doc ?? null;
		}
		console.warn(`rogue-trader | compendium pack ${parts[1]}.${parts[2]} not found`);
		return null;
	}
	// fvtt-types types fromUuid's parameter as a template-literal UUID union,
	// but a uuid here is an arbitrary string — cast at this one boundary (the
	// rules/adapter documentFromUuid precedent). This module entered the
	// scoped type graph in bead qg4z, when the damage-adapter started pulling
	// the doc-link catalogs through this file.
	return (await foundry.utils.fromUuid(uuid as never)) ?? null;
}

/**
 * Fetch a compendium pack's documents (bead ku1i consolidation, routed
 * through the infrastructure primitive in bead s4lu): one loud missing-pack
 * warning per fetch instead of 22 silent no-ops. Empty list means "pack
 * missing or empty" — callers that distinguish can check the pack's
 * existence separately.
 */
export async function getPackDocuments(packId: string): Promise<unknown[]> {
	const docs = await packDocuments(packId);
	if (docs === null) {
		console.warn(`rogue-trader | compendium pack ${packId} not installed`);
		return [];
	}
	return docs;
}

/**
 * Session cache for the compendium pack fetches (bead j4io, owner-approved
 * 2026-09-29): the compendium does not change mid-session, so memoizing the
 * pack-fetch PROMISES (keyed per caller) also dedupes concurrent loads. A
 * rejected fetch is evicted so the next caller retries.
 *
 * LIVES here (bead qg4z): the chat-card doc links resolve their weapon/power
 * names against pack catalogs, so the memoize moved off the advancement
 * dialog into the open path every surface imports from — one cache, one
 * eviction semantics.
 */
const packDocsCache = new Map<string, Promise<unknown[]>>();

/** Memoize a pack fetch under `key` (bead j4io's cache, now shared). */
export function packDocsOnce(
	key: string,
	load: () => Promise<unknown[]>,
): Promise<unknown[]> {
	let promise = packDocsCache.get(key);
	if (!promise) {
		promise = load().catch((error: unknown) => {
			packDocsCache.delete(key);
			throw error;
		});
		packDocsCache.set(key, promise);
	}
	return promise;
}

/** Concept pack holding the character-option Items (bead 4tj1). */
export const CHARACTER_OPTIONS_PACK = "rogue-trader.character-options";

/**
 * Character-option documents of ONE Item type from the merged concept pack
 * (bead 4tj1) — the replacement for the per-pack
 * per-source getPackDocuments idiom. Types: skill, talent,
 * career, origin, origintrait, psychicpower, navigatorpower, aptitude, trait.
 */
export async function getCharacterOptionDocs(type: string): Promise<unknown[]> {
	const docs = await getPackDocuments(CHARACTER_OPTIONS_PACK);
	return docs.filter((doc) => (doc as { type?: string }).type === type);
}

/** Memoized once-per-session character-option pack fetch (bead j4io). */
export function characterOptionDocsOnce(type: string): Promise<unknown[]> {
	return packDocsOnce(`character-options:${type}`, () =>
		getCharacterOptionDocs(type),
	);
}

/** Open a resolved document's sheet, loudly reporting a missing binding.
 * @param notifyKey  i18n key for the failure toast; defaults to the career
 *   link key — bead ha1y's advancement rows pass their own.
 */
export async function openDocumentSheet(
	item: unknown,
	label: string,
	notifyKey = "BACKGROUND.OPEN_CAREER_FAIL",
	// Toast vars (bead e72x B2): undefined keeps the career callers' exact
	// no-vars behaviour; the advancement site passes { uuid } so the key's
	// placeholder interpolates instead of rendering literally.
	vars?: Record<string, unknown>,
): Promise<void> {
	const sheet = (item as { sheet?: { render: (o?: object) => unknown } }).sheet;
	if (!sheet) {
		console.error(`rogue-trader | ${label}: resolved document has no sheet:`, item);
		getPorts().notify.error(notifyKey, vars);
		return;
	}
	await sheet.render({ force: true });
}
/**
 * Sheet action: open the compendium source of an owned item (bead kwm9,
 * shared by CharacterSheet + NpcSheet). Reads data-uuid off the target —
 * the packer stamps the compendiumSource flag under the system's chat-flag
 * namespace (RT's value is "rogue-trader") on every embedded item that
 * resolves from a pack (et3x). Items without a stamp
 * (standalone book traits, homebrew) render no link, so a missing uuid is
 * a normal no-op.
 */
export async function openPackItemAction(
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const uuid = target.dataset.uuid;
	if (!uuid) return;
	try {
		const item = await resolvePackDocument(uuid);
		if (!item) {
			console.warn(`rogue-trader | pack item link: "${uuid}" did not resolve`);
			return;
		}
		await openDocumentSheet(item, "pack item link");
	} catch (error) {
		console.error("rogue-trader | pack item link failed:", error);
	}
}
