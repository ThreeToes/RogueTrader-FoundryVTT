/**
 * Chat-card doc links (epic 61pk, bead qg4z): the weapon/power name on the
 * attack / damage / psychic / navigator chat cards links to its compendium
 * doc — clicking opens the pack item's sheet read-only through the sheet
 * open path (pack-resolve's resolvePackDocument + openDocumentSheet, wired in
 * presentation/chat-actions.ts on the OPEN_PACK_DOC_ACTION convention).
 *
 * SEAM: the names resolve against the SAME memoized pack fetches the
 * compendium surfaces use today (bead j4io's once-cache, now shared via
 * pack-resolve's packDocsOnce) — psychic/navigator powers from the
 * character-options concept pack, weapons from the equipment pack (plus the
 * afflictions pack's mutation attacks, which attack like weapons — bead
 * kam1). Resolution itself goes through the library's packDocAnchor
 * (exact-name branch); an unresolvable name — hand-made gear, renamed items,
 * anything not in the packs — returns null and the card degrades to plain
 * text, never an error.
 *
 * The card title is one display string ("Actor — Weapon" damage-card flavour
 * "Attacker → Target — Weapon"), so the anchor needs the DECOMPOSED title:
 * prefix (the actor/target part) + name (the anchored span) + suffix (a
 * parenthesised label like a psychic Strength). chatCardTitleDoc builds that
 * payload; the four card pipelines add it as the `titleDoc` template var and
 * template/chat/roll.hbs + damage.hbs render it.
 */

import { packDocAnchor } from "../sheet/pack-doc-links";
import {
	characterOptionDocsOnce,
	getPackDocuments,
	packDocsOnce,
} from "../sheet/pack-resolve";
import type { PackDocAnchor, PackDocLike } from "../sheet/pack-doc-links";

/** The pack doc kinds a chat-card title can link to. */
export type ChatDocKind = "weapon" | "psychicpower" | "navigatorpower";

const EQUIPMENT_PACK = "rogue-trader.equipment";
const AFFLICTIONS_PACK = "rogue-trader.afflictions";

/** Weapon-shaped pack docs: pure weapon items (weapons folder) + mutations. */
const WEAPON_TYPES = new Set(["ranged-weapon", "melee-weapon"]);
const MUTATION_TYPES = new Set(["mutation"]);

/**
 * Map fetched compendium docs into the library's {key, name, uuid} catalog
 * shape (the advancement dialog's enrichment, generalised): docs without a
 * name or uuid cannot resolve OR open, so they are dropped loudly-by-construction
 * (they were never resolvable rows).
 */
export function toPackDocCatalog(
	docs: unknown[],
	keep: (doc: { type?: string }) => boolean = () => true,
): PackDocLike[] {
	return docs.filter((doc) => keep(doc as { type?: string })).map((doc) => {
		const d = doc as {
			name?: string;
			uuid?: string;
			system?: { key?: string };
		};
		return {
			key: d.system?.key ?? "",
			name: d.name ?? "",
			uuid: d.uuid ?? "",
		};
	}).filter((doc) => doc.name !== "" && doc.uuid !== "");
}

/**
 * The per-kind catalog PROMISES (same memoize pattern as packDocsOnce, on the
 * MAPPED catalog this time): a rejected load is evicted so the next roll
 * retries instead of caching the failure for the session.
 */
const catalogs = new Map<ChatDocKind, Promise<PackDocLike[]>>();

async function loadCatalog(kind: ChatDocKind): Promise<PackDocLike[]> {
	if (kind === "psychicpower" || kind === "navigatorpower") {
		return toPackDocCatalog(await characterOptionDocsOnce(kind));
	}
	// Weapons live in the equipment concept pack (ranged + melee-weapon
	// resolved by the folder rule); mutation attacks (bead kam1) live in the
	// afflictions pack. These packDocsOnce keys are chat-doc-links-LOCAL —
	// the warmers fetch the equipment pack directly (uncached), so there is
	// NO cache-share on this branch; the SHARED cache is the character-
	// options fetch (characterOptionDocsOnce) the psychic/navigator branch
	// above uses (bead oo5b F5).
	const [equipment, afflictions] = await Promise.all([
		packDocsOnce("chat-doc-links:equipment", () =>
			getPackDocuments(EQUIPMENT_PACK),
		),
		packDocsOnce("chat-doc-links:afflictions", () =>
			getPackDocuments(AFFLICTIONS_PACK),
		),
	]);
	return [
		...toPackDocCatalog(equipment, (doc) => WEAPON_TYPES.has(doc.type ?? "")),
		...toPackDocCatalog(afflictions, (doc) => MUTATION_TYPES.has(doc.type ?? "")),
	];
}

function catalog(kind: ChatDocKind): Promise<PackDocLike[]> {
	let promise = catalogs.get(kind);
	if (!promise) {
		promise = loadCatalog(kind).catch((error: unknown) => {
			catalogs.delete(kind);
			throw error;
		});
		catalogs.set(kind, promise);
	}
	return promise;
}

/**
 * The anchor behind a card's item name, or null — the plain-text degradation
 * (unresolvable names, hand-made items, a catalog load that failed). Never
 * throws: the roll card must post regardless of pack state.
 */
export async function chatCardDocAnchor(
	name: string,
	kind: ChatDocKind,
): Promise<PackDocAnchor | null> {
	if (!name.trim()) return null;
	try {
		return packDocAnchor({ key: "", name }, await catalog(kind), [], name);
	} catch (error) {
		console.warn(
			`rogue-trader | chat doc link: the ${kind} catalog could not be loaded; the name renders as plain text`,
			error,
		);
		return null;
	}
}

/** The titleDoc template var: the card title, decomposed for the anchor. */
export interface ChatCardTitleDoc {
	/** The actors/target part of the title ("Actor — ", "Atk → Target — "). */
	prefix: string;
	/** The item name — rendered as the anchor (or plain text). */
	name: string;
	/** A parenthesised label after the name (" (Unfettered)"), when any. */
	suffix: string;
	/** The pack-doc anchor; null → the name renders as plain text. */
	link: PackDocAnchor | null;
}

/**
 * Build the decomposed title for one of the four linking cards. Always
 * resolves (link possibly null): the template's `{{#if titleDoc}}` branch
 * renders prefix + name + suffix, identical to the unstructured title when
 * no pack doc matched.
 */
export async function chatCardTitleDoc(options: {
	prefix: string;
	name: string;
	kind: ChatDocKind;
	suffix?: string;
}): Promise<ChatCardTitleDoc> {
	return {
		prefix: options.prefix,
		name: options.name,
		suffix: options.suffix ?? "",
		link: await chatCardDocAnchor(options.name, options.kind),
	};
}