/**
 * The warmed talent-doc link catalog (epic 61pk, bead hjve): {key, name, uuid}
 * rows the character creator's talent pick chips (origin-row optionChoice
 * values, e.g. "Jaded") resolve their pack-doc links against, through
 * sheet/pack-doc-links.ts packDocAnchor.
 *
 * Pure data: the pool + mapping live HERE (the warrant-creator precedent,
 * bead 5rk0 — one shared mapper so the ready warmer and the on-demand fill
 * cannot drift), while every fetch lives at the edges: bootstrap/warmers.ts
 * warms the pool at `ready`, and the character creator fills it on demand
 * from its own context build when the wizard opens pre-ready (the creator
 * already carries the pack fetch imports; the rules layer must not, or the
 * scoped typecheck would drag sheet/ into the rules graph).
 *
 * Content-optional: a missing pack leaves the pool EMPTY and the chips
 * degrade to plain text (never an error) — same contract as every warmer.
 */

// The catalog SHAPE is the pack-doc link library's PackDocLike (bead n2b2).
// sheet/pack-doc-links.ts is pure — rules -> presentation is the recorded
// inversion allowance (roll-system precedent), and the library stays
// Foundry-free so the scoped typecheck graph stays clean.
import type { PackDocLike } from "../sheet/pack-doc-links";
import { str } from "../data/pack-fields";

let talentLinkDocs: PackDocLike[] = [];

/** The warmed talent-doc link catalog (empty until ready / first use). */
export function getTalentLinkDocs(): PackDocLike[] {
	return talentLinkDocs;
}

/**
 * The SHARED doc→row mapping (bead 5rk0 precedent): bootstrap/warmers.ts's
 * ready warmer and the on-demand ensure below both build rows through this,
 * so they cannot drift.
 */
export function talentLinkDocFromDoc(doc: {
	name?: string;
	uuid?: string;
	system?: unknown;
}): PackDocLike {
	const s = (doc.system ?? {}) as Record<string, unknown>;
	return {
		key: str(s, "key"),
		name: doc.name ?? "",
		uuid: doc.uuid ?? "",
	};
}

/** Replace the catalog (the warmer's and the creator's fill both). */
export function setTalentLinkDocs(rows: PackDocLike[]): void {
	talentLinkDocs = rows;
}