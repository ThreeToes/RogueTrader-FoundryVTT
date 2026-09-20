/**
 * Table 1-2: Heirloom Items (Core Rulebook p31; epic 1gb7 follow-up; split out
 * of origins.ts by bead 8hkq).
 *
 * The per-heirloom content (key, 1d100 range, grant payload) lives in the
 * private `heirlooms` compendium pack; the verbatim prose stays in the
 * `creationtables` RollTable "Table 1-2: Heirloom Items", whose result flags
 * carry the matching `key`. This module keeps the shared types, the runtime
 * pool (warmed from the pack at ready), and the 1d100 lookup.
 *
 * WHY IT IS ITS OWN MODULE: the heirloom table is a Table 1-2 grant lookup and
 * has nothing to do with the Origin Path chart, but it used to live inside
 * origins.ts because both were warmed from packs at ready. Origins now holds
 * only chart machinery (see domain/model/chart.ts).
 *
 * Curation (owner-verify, carried from bead rboc): the book grants a generic
 * Best-Craftsmanship chainsword / carapace set; the packs model them as the
 * Hecate chainsword and Storm Trooper Carapace full set, cloned + renamed.
 */

export type HeirloomGrantKind = "pack-item" | "note-item";

export interface HeirloomGrant {
	kind: HeirloomGrantKind;
	/** pack-item: compendium pack id to clone from. */
	pack?: string;
	/** pack-item: source item name in that pack. */
	item?: string;
	/** pack-item: craftsmanship override (e.g. "best"). */
	craftsmanship?: string;
	/** pack-item: rename the clone (the book's own item name). */
	rename?: string;
	/** note-item: description for the granted special-ability item. */
	noteText?: string;
}

export interface HeirloomEntry {
	/** Stable slug; matches the source RollTable result's item flag. */
	key: string;
	name: string;
	/** 1d100 range of the source table row. */
	range: [number, number];
	/** Source RollTable ("rolltables/Table 1-2: Heirloom Items"). */
	table?: string;
	grant: HeirloomGrant;
}

/** Runtime heirloom pool (warmed from the `heirlooms` pack at ready). */
let heirloomPool: HeirloomEntry[] = [];

/** Replace the runtime heirloom pool (pack loader / tests). */
export function setHeirloomEntries(entries: HeirloomEntry[]): void {
	heirloomPool = entries;
}

/** The current runtime heirloom pool. */
export function getHeirloomEntries(): HeirloomEntry[] {
	return heirloomPool;
}

/** The heirloom entry for a 1d100 result; loud failure outside 1-100. */
export function heirloomForRoll(roll: number): HeirloomEntry {
	const n = Math.floor(roll);
	const entry = heirloomPool.find((e) => n >= e.range[0] && n <= e.range[1]);
	if (!entry) throw new Error(`Heirloom roll ${n} outside Table 1-2 (1-100)`);
	return entry;
}
