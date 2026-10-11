/**
 * Talent prerequisite evaluator (bead tfk) — PURE, sample-first: parses the
 * book's Table 4-1 prerequisite grammar and evaluates against an actor
 * snapshot. Soft enforcement lives at acquisition points (talent picker,
 * advancement dialog): unmet prereqs surface in a confirm dialog, GM
 * overridable — never a hard block.
 *
 * Grammar (verified against Core Rulebook Table 4-1 p92-94 samples):
 *   "—" / ""            -> no prerequisites
 *   "Fel 30"            -> characteristic threshold (Fel/WS/BS/S/T/Ag/Int/Per/WP)
 *   "Psy Rating 2"      -> psyker with at least that Psy Rating
 *   "Acrobatic"         -> talent-chain prereq (owned talent by name)
 *   "Jaded or Resistance (Poisons)" -> OR-list of atoms
 *   "Acrobatic, Jaded, or Resistance (Poisons)"
 *      -> AND[Acrobatic] + OR[Jaded, Resistance]. The trailing "or"-chunk
 *      binds ONLY to the immediately previous comma segment: the book's
 *      Oxford-comma style makes "Acrobatic" a standalone AND atom, and only
 *      "Jaded, or Resistance (Poisons)" merges into one OR group.
 *   comma-separated atoms are AND; "or" (case-insensitive) binds a group.
 *   (a comma immediately followed by "or" extends that OR group — bead rl1u).
 *
 * Special prerequisites ("Mechanicus Implants", "Pure Faith") parse as
 * talent-name atoms — the GM adjudicates via the soft-confirm path.
 */

import type { CharacteristicKey } from "../data/actor/character";

/** Characteristic tokens as they appear in book notation -> schema keys. */
const CHARACTERISTIC_TOKENS: Record<string, CharacteristicKey> = {
	ws: "ws",
	"weapon skill": "ws",
	bs: "bs",
	"ballistic skill": "bs",
	s: "s",
	strength: "s",
	t: "t",
	toughness: "t",
	ag: "ag",
	agility: "ag",
	int: "int",
	intelligence: "int",
	per: "per",
	perception: "per",
	wp: "wp",
	willpower: "wp",
	fel: "fel",
	fellowship: "fel",
};

export interface CharacteristicPrereq {
	kind: "characteristic";
	key: CharacteristicKey;
	value: number;
}

export interface TalentPrereq {
	kind: "talent";
	name: string;
}

export interface PsyRatingPrereq {
	kind: "psyRating";
	value: number;
}

export type PrereqAtom = CharacteristicPrereq | TalentPrereq | PsyRatingPrereq;

/** Parsed prerequisite structure: AND of groups; each group is an OR list. */
export interface ParsedPrerequisites {
	groups: PrereqAtom[][];
	/** Raw string, preserved for display (never silently dropped). */
	raw: string;
}

export interface ActorPrereqSnapshot {
	characteristics: Partial<Record<CharacteristicKey, number>>;
	/** Owned/known talent names (lowercased for matching). */
	talents: string[];
	psyRating?: number;
}

/** Parse a book prerequisite string. Empty/"-" => no prerequisites. */
export function parsePrerequisites(raw: string): ParsedPrerequisites {
	const raw_ = (raw ?? "").trim();
	if (raw_ === "" || raw_ === "—" || raw_ === "-") {
		return { groups: [], raw: raw_ };
	}
	// Split top-level OR groups, keeping comma-separated AND atoms together:
	// "Acrobatic, Ag 40 or Fel 40" => AND[ [Acrobatic], OR[Ag 40, Fel 40] ].
	const segments = raw_
		.split(/,\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
	// Oxford-comma OR lists ("Acrobatic, Jaded, or Resistance (Poisons)") put
	// the trailing "or" at the START of its comma segment with no whitespace
	// before it, so the plain /\s+or\s+/ split below would miss it and yield a
	// bogus talent atom named "or ...".  A segment beginning with "or" extends
	// the previous comma-separated alternative into the same OR group (rl1u).
	const chunks: string[] = [];
	// A BARE "or" comma segment ("Foo, or, Bar") leaves an empty remainder:
	// it is dropped, but the OR-binding rolls forward onto the NEXT segment so
	// no bogus talent atom named "or" appears and the next chunk still joins
	// the previous one (bead i7ov).
	let pendingOr = false;
	for (const rawSegment of segments) {
		// ^or\b (not ^or\s+) so a bare "or" segment is caught too.
		const orLead = /^or\b/i.test(rawSegment);
		const segment = rawSegment.replace(/^or\b/i, "").trim();
		if (segment === "") {
			if (orLead && chunks.length > 0) pendingOr = true;
			continue;
		}
		if ((orLead || pendingOr) && chunks.length > 0) {
			pendingOr = false;
			const prev = chunks[chunks.length - 1]!;
			chunks[chunks.length - 1] = `${prev} or ${segment}`;
		} else {
			pendingOr = false;
			chunks.push(segment);
		}
	}
	const groups: PrereqAtom[][] = [];
	for (const chunk of chunks) {
		const alternatives = chunk
			.split(/\s+or\s+/i)
			.map((s) => s.trim())
			.filter(Boolean);
		const atoms = alternatives
			.map(parseAtom)
			.filter((a): a is PrereqAtom => a !== null);
		if (atoms.length > 0) groups.push(atoms);
	}
	return { groups, raw: raw_ };
}

/** Parse one atom; unknown forms parse as a talent-chain name. */
function parseAtom(atom: string): PrereqAtom | null {
	const cleaned = atom.trim();
	if (!cleaned) return null;

	// Characteristic threshold: "Fel 30" / "Fellowship 30".
	const charMatch = /^([A-Za-z]+)\s+(\d{1,3})$/.exec(cleaned);
	if (charMatch) {
		const key = CHARACTERISTIC_TOKENS[charMatch[1]!.toLowerCase()];
		if (key)
			return { kind: "characteristic", key, value: Number(charMatch[2]) };
	}

	// Psy Rating threshold: "Psy Rating 2".
	const psyMatch = /^psy\s*rating\s*(\d+)$/i.exec(cleaned);
	if (psyMatch) {
		return { kind: "psyRating", value: Number(psyMatch[1]) };
	}

	// Anything else is a talent-chain prerequisite (matched by name, case-
	// insensitive); specials like "Mechanicus Implants" ride this path.
	return { kind: "talent", name: cleaned };
}

/** Evaluate parsed prerequisites; returns unmet atom descriptions. */
export function evaluatePrerequisites(
	parsed: ParsedPrerequisites,
	actor: ActorPrereqSnapshot,
): { met: boolean; unmet: string[] } {
	const unmet: string[] = [];
	for (const group of parsed.groups) {
		// A group is met when ANY atom in it is met (OR).
		const satisfied = group.some((atom) => atomMet(atom, actor));
		if (!satisfied) {
			unmet.push(group.map(atomLabel).join(" OR "));
		}
	}
	return { met: unmet.length === 0, unmet };
}

function atomMet(atom: PrereqAtom, actor: ActorPrereqSnapshot): boolean {
	switch (atom.kind) {
		case "characteristic": {
			const value = actor.characteristics[atom.key] ?? 0;
			return value >= atom.value;
		}
		case "talent":
			return actor.talents.some(
				(owned) => owned.toLowerCase() === atom.name.toLowerCase(),
			);
		case "psyRating":
			return (actor.psyRating ?? 0) >= atom.value;
	}
}

function atomLabel(atom: PrereqAtom): string {
	switch (atom.kind) {
		case "characteristic":
			return `${atom.key.toUpperCase()} ${atom.value}`;
		case "talent":
			return atom.name;
		case "psyRating":
			return `Psy Rating ${atom.value}`;
	}
}
