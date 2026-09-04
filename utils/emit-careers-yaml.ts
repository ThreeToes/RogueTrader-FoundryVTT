#!/usr/bin/env bun
/**
 * Emit the careers pack YAML from parse-careers.mjs JSON output, in SCHEMA
 * SHAPE for the Career data model (bead 2n5):
 *
 *   - key: career slug (from the parse step)
 *   - characteristicAdvances: ws/bs/s/t/ag/int/per/wp/fel -> 4-level costs
 *   - ranks: [{ rank, xpLevel, advances }] with xpLevel from Table 2-2
 *     (stored PER-RANK, owner option a)
 *   - advances: {key, name, type, cost, multiplier, prerequisites}
 *     - `key` resolves against the skills/talents packs (name match, with
 *       +10/+20 ladder suffix stripped for skills); UNRESOLVABLE rows keep
 *       the verbatim `name` and are REPORTED — curation decides whether a
 *       row is genuinely unkeyable ("(Choose One)", missing specializations)
 *       or a mapping bug. Rows that SHOULD have keyed but did not are curation
 *       patches in the config block below, per the extraction conventions.
 *   - prerequisites: verbatim book strings (structured parsing arrives with
 *     the soft-enforcement layer, cf. tfk)
 *
 * Usage: bun utils/emit-careers-yaml.ts
 */
import { readFileSync, existsSync } from "node:fs";
import yaml from "yaml";

const PARSED = "src/packs/.extraction-src/careers-parsed.json";
const SKILLS_YAML = "src/packs/skills/skills.yaml";
const TALENTS_YAML = "src/packs/talents/talents.yaml";
const OUT = "src/packs/careers/careers.yaml";

if (!existsSync(PARSED)) {
	throw new Error(`run src/packs/.extraction-src/parse-careers.mjs first (${PARSED} missing)`);
}

const parsed = yaml.parse(readFileSync(PARSED, "utf8")) as CareerParsed[];
const skillNames = namesFrom(SKILLS_YAML);
const talentNames = namesFrom(TALENTS_YAML);

function namesFrom(path: string): Set<string> {
	const docs = yaml.parse(readFileSync(path, "utf8")) as Array<{ name: string }>;
	return new Set(docs.map((d) => d.name));
}

/** Book name -> slug key, matching the registry/talent prereq convention. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[’']g/g, "g")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Table 2-2 (p38): XP level at which each rank begins. */
const RANK_XP: Record<number, number> = {
	1: 5000,
	2: 7000,
	3: 10000,
	4: 13000,
	5: 17000,
	6: 21000,
	7: 25000,
	8: 30000,
};

interface CareerParsed {
	name: string;
	key: string;
	page: number;
	shortDescription: string;
	description: string;
	startingSkills: string[];
	startingTalents: string[];
	startingGear: string[];
	characteristicAdvances: Record<
		string,
		{ simple: number; intermediate: number; trained: number; expert: number }
	>;
	ranks: Array<{
		rank: number;
		advances: Array<{
			name: string;
			cost: number;
			type: string;
			prerequisites: string[];
		}>;
	}>;
}

const unkeyed: string[] = [];

/**
 * Book name -> pack name match. Exact first; then prefix-tolerant (either
 * direction, min 8 chars) because the current talents pack carries clipped
 * names ("Iron Discipl"; bead 3mj rebuilds it) and the skills pack differs
 * in singular/plural ("Drive (Ground Vehicles)").
 */
function matchesPack(bookName: string, packNames: Set<string>): string | null {
	const norm = (s: string) => s.replace(/-/g, " ");
	const book = norm(bookName);
	if (packNames.has(bookName)) return bookName;
	for (const packName of packNames) {
		if (norm(packName) === book) return packName;
	}
	for (const packName of packNames) {
		if (packName.length < 8) continue;
		if (book.startsWith(norm(packName)) || norm(packName).startsWith(book)) {
			return packName;
		}
	}
	return null;
}

/**
 * Curation patches for the book's OWN typos (each verified against the PDF):
 * - "Decieve" — rt_core misspells Deceive in the Void-master rank tables
 *   (p71, p72, verified in the PDF text layer 2026-09-04);
 * - "Totall Recall" — misspells Total Recall, Astropath rank 5 (p50, verified);
 * - "Good Repuatation (Ecclesiarchy)" — misspells Good Reputation,
 *   Missionary rank 1 (p60, verified in the PDF text layer).
 */
const TYPO_KEY_MAP: Record<string, string> = {
	Decieve: "deceive",
	"Totall Recall": "total-recall",
	"Good Repuatation (Ecclesiarchy)": "good-reputation",
};

/** Resolve an advance row to {key, name, multiplier}. */
function keyAdvance(
	name: string,
	type: string,
): { key: string; name: string; multiplier: number } {
	let multiplier = 1;
	let clean = name;
	// (x2)" multiplier rows (book: purchasable up to N times at that Rank).
	const mult = /\(x(\d+)\)\s*$/.exec(clean);
	if (mult) {
		multiplier = Number(mult[1]);
		clean = clean.slice(0, mult.index).trim();
	}
	// Page furniture glue: wrapped names occasionally pick up a page number.
	clean = clean.replace(/\s+\d{1,3}$/, "");
	if (/\(Choose One\)/i.test(clean)) {
		unkeyed.push(`[choice] ${clean}`);
		return { key: "", name: clean, multiplier };
	}
	if (TYPO_KEY_MAP[clean]) {
		return { key: TYPO_KEY_MAP[clean], name: "", multiplier };
	}
	if (type === "skill") {
		// "+10"/"+20" ladder rows resolve to the base skill pack key.
		const base = clean.replace(/\s*\+\d+\s*$/, "").trim();
		// Specializations ("Common Lore (Imperium)") resolve to the base skill
		// ("Common Lore") when no exact specialization entry exists.
		const generic = base.replace(/\s*\([^)]*\)\s*$/, "").trim();
		for (const candidate of [clean, base, generic]) {
			const match = matchesPack(candidate, skillNames);
			if (match) return { key: slugify(match), name: "", multiplier };
		}
		// Book-typos + ladder suffix ("Decieve +10", VERIFIED p71-72).
		for (const [typo, key] of Object.entries(TYPO_KEY_MAP)) {
			if (base.startsWith(typo) || clean.startsWith(typo)) {
				return { key, name: "", multiplier };
			}
		}
	} else {
		const match = matchesPack(clean, talentNames);
		if (match) return { key: slugify(match), name: "", multiplier };
		// Specialized talents ("Hatred (Pirates)") resolve to the base talent.
		const generic = clean.replace(/\s*\([^)]*\)\s*$/, "").trim();
		if (generic !== clean) {
			const baseMatch = matchesPack(generic, talentNames);
			if (baseMatch) return { key: slugify(baseMatch), name: "", multiplier };
		}
	}
	// Specializations not in the packs ("Speak Language (Trader's Cant)") stay
	// verbatim; curation may add pack entries later.
	unkeyed.push(`[${type}] ${clean}`);
	return { key: "", name: clean, multiplier };
}

const documents = parsed.map((career) => ({
	name: career.name,
	type: "Item",
	description: career.description,
	system: {
		key: career.key,
		shortDescription: career.shortDescription,
		source: { book: "rt_core", page: career.page },
		aptitudes: [],
		characteristicAdvances: career.characteristicAdvances,
		startingSkills: career.startingSkills,
		startingTalents: career.startingTalents,
		startingGear: career.startingGear,
		ranks: career.ranks.map((rank) => ({
			rank: rank.rank,
			xpLevel: RANK_XP[rank.rank] ?? 0,
			advances: rank.advances.map((adv) => {
				const resolved = keyAdvance(adv.name, adv.type);
				return {
					key: resolved.key,
					name: resolved.name,
					type: adv.type,
					cost: adv.cost,
					multiplier: resolved.multiplier,
					prerequisites: adv.prerequisites,
				};
			}),
		})),
	},
}));

const header = `# Careers pack (beads 2n5/rcv): core-8 from rt_core Chapter II
# (p36-71), emitted by utils/emit-careers-yaml.ts from the parse-careers.mjs
# JSON. VERBATIM book text (short descriptions from Table 2-1 p37, prose from
# the career sections, rank tables p41-72). Rank xpLevel stored per-rank
# (owner option a). Advance "key" fields resolve against the skills/talents
# packs; rows the packs cannot resolve keep the verbatim name (see unkeyed
# report). Aptitudes are unpopulated: the book does not list per-career
# aptitudes in Chapter II (curation pending owner input).

`;

const body = yaml.stringify(documents, { lineWidth: 120 });
const { writeFileSync } = await import("node:fs");
writeFileSync(OUT, header + body);
console.log(`[careers] ${documents.length} documents -> ${OUT}`);

if (unkeyed.length) {
	console.log(`\n[careers] UNKEYED ROWS (${unkeyed.length}) — verify each is genuinely unkeyable:`);
	for (const row of unkeyed) console.log(`  ${row}`);
} else {
	console.log("[careers] all advance rows keyed");
}