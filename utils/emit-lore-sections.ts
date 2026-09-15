#!/usr/bin/env bun
/**
 * Emit the cstp lore sections into the lore pack (bead cstp).
 *
 * The lore pack's other journals were authored by hand with verbatim prose;
 * this emitter appends the machine-extracted sections (cstp-sections.json,
 * produced by the Python extractor) to the matching journal, preserving the
 * existing pages exactly and only adding the new ones at the end.
 *
 * Behaviour:
 *  - loads src/packs/rogue_trader/lore/lore.yaml
 *  - finds/creates each target journal
 *  - appends the extracted pages, VERBATIM prose as <p> blocks
 *  - refuses to add a page whose name already exists (idempotent re-runs)
 *
 * Usage: bun utils/emit-lore-sections.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import yaml from "yaml";

const SECTIONS = "src/packs/.extraction-src/cstp-sections.json";
const OUT = "src/packs/rogue_trader/lore/lore.yaml";

interface Section {
	journal: string;
	name: string;
	source: string;
	paragraphs: string[];
	/** Right-column boxed copy (HA layout pages carry marginal sidebars). */
	sidebars?: string[];
}

/**
 * Sections that open a NEW journal (no existing journal fits the book).
 * Created on demand with the lore-pack default-2 ownership.
 */
const NEW_JOURNALS: Record<string, { ownership: { default: number } }> = {
	"Hostile Acquisitions": { ownership: { default: 2 } },
	"Light on the Fringe": { ownership: { default: 2 } },
};

/**
 * Sidebar copy collected from the layout's right column, appended after the
 * body so materially-important boxed rules (the Von Darnus excerpt, the Lex
 * Imperialis explainer, crime-category boxes) are preserved verbatim rather
 * than dropped on the floor.
 */
function sidebarsHtml(sidebars: string[] | undefined): string {
	if (!sidebars?.length) return "";
	const out: string[] = ["<h3>Sidebars</h3>"];
	for (const s of sidebars) {
		const bare = s.replace(/[.]$/, "").trim();
		if (isHeadingRun(bare) && bare.split(/\s+/).length <= 8) {
			out.push(`<h3>${displayHeading(bare)}</h3>`);
		} else {
			out.push(`<p>${s}</p>`);
		}
	}
	return out.join("\n");
}

/**
 * Pages that merge into an existing page instead of becoming new ones.
 * Scope note: EA Ch IV "Famous Rogue Traders" extends the rt_core roster on
 * "Rogue Traders Known Within the Expanse" (link, don't duplicate).
 */
const MERGE_INTO: Record<
	string,
	{ journal: string; page: string; source: string }
> = {
	"Famous Rogue Traders — Introduction": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp100-101",
	},
	"Calligos Winterscale": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp101-104",
	},
	"Aspyce Chorda": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp104-108",
	},
	"Jonquin Saul": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp108-110",
	},
	"Aoife Armengarde": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp110-114",
	},
	"Sarvus Trask": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp114-115",
	},
	"Wrath Umboldt": {
		journal: "The Koronus Expanse",
		page: "Rogue Traders Known Within the Expanse",
		source: "edge_of_the_abyss pp115-118",
	},
};

if (!existsSync(SECTIONS)) {
	throw new Error(`run the cstp extractor first (${SECTIONS} missing)`);
}
/**
 * Columnar-book sections (Hostile Acquisitions Ch I/V crimes/law + Cold Trade,
 * Faith and Coin Ch I Light on the Fringe).
 *
 * Extracted from the RAW text (correct reading order) by
 * extract-columnar-cstp.py, then cleaned by clean-cstp-sections.py: watermarks
 * and rotated furniture dropped, column-continuation fragments rejoined,
 * dropcaps restored, and small-caps run-in headings split out and title-cased.
 * Section boundaries are PINNED line numbers (see the extractor) because the
 * headings repeat in the contents and wrap across lines.
 */
const COLUMNAR_SECTIONS = "src/packs/.extraction-src/ha-cstp-sections.json";
const sections = [
	...(yaml.parse(readFileSync(SECTIONS, "utf8")) as Section[]),
	...(existsSync(COLUMNAR_SECTIONS)
		? (yaml.parse(readFileSync(COLUMNAR_SECTIONS, "utf8")) as Section[])
		: []),
];

interface Page {
	name: string;
	text?: string;
	"src"?: unknown;
	source?: string;
	[key: string]: unknown;
}
interface Journal {
	name: string;
	ownership?: { default: number };
	pages: Page[];
	[key: string]: unknown;
}

const docs = yaml.parse(readFileSync(OUT, "utf8")) as Journal[];

/**
 * Headings the extractor left inline because the raw text layer separates the
 * heading line from the prose it interrupts (the Rak'Gol heading splits the
 * sentence "Where the Rak'Gol cross the Expanse, ..."). Rejoining is a
 * lossless reflow of the printed text, not an edit.
 */
const INTERRUPTED_HEADS: Record<string, [string, string]> = {
	// [glued prefix as extracted, restored prefix]
	"The Rak'Gol": ["The Rak’Gol cross the Expanse", "Where the Rak’Gol cross the Expanse"],
};

/**
 * Printed run-in headings. The books set these in small caps, which the text
 * layer renders as an ALL-CAPS run leading (or alone in) a paragraph. A
 * generic caps rule would eat shouty prose, so a caps run is promoted only
 * when it is a known heading or is a short standalone sentence-less run.
 */
/**
 * Display a detected heading in the book's small-caps style, undoing the
 * text layer's irregular capitals ("ImperIaL CrImes" -> "Imperial Crimes").
 * A run that is already consistently capitalised keeps its form; a run whose
 * capitals move around is treated as small caps and title-cased.
 */
function displayHeading(text: string): string {
	const letters = [...text].filter((c) => /[A-Za-z]/.test(c));
	if (letters.length === 0) return text;
	// The text layer emits the books' small-caps headings with irregular
	// capitals ("ImperIaL CrImes", "seCTor and", "Common punIshmenTs").
	// Small caps scatter capitals MID-WORD, which ordinary title case never
	// does; that is the reliable signal.
	const words = text.split(/\s+/).filter(Boolean);
	const midWordCap = words.some((w) => {
		const core = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
		return /[A-Z]/.test(core.slice(1));
	});
	const hasLowerAfterCap = words.some((w) => /[A-Z].*[a-z]/.test(w));
	if (!midWordCap || !hasLowerAfterCap) {
		// Already ordinary casing (real caps or Title Case): leave as printed.
		return text;
	}
	return text
		.toLowerCase()
		.split(" ")
		.map((w) =>
			w
				.split(/([^A-Za-z]+)/)
				.map((seg) =>
					/^[A-Za-z]/.test(seg) ? seg[0].toUpperCase() + seg.slice(1) : seg,
				)
				.join(""),
		)
		.join(" ");
}

/**
 * Small-caps headings survive the text layer in mixed case with irregular
 * capitals ("ImperIaL CrImes"), so matching is done on an uppercased copy.
 */
function normaliseHeadingCase(text: string): string {
	return text.toUpperCase();
}

/**
 * A line is a run-in heading only when it is SHORT and label-like. Sentence
 * fragments that happen to carry odd capitals ("sentence is often very short.",
 * "relative severity of the punishment.") must not become headings, so a
 * heading must not end a sentence and must be at most a few words.
 */
function isHeadingRun(text: string): boolean {
	const t = text.trim();
	if (!t || /[.!?]$/.test(t)) return false;
	if (/^\d+$/.test(t)) return false;
	if (t.split(/\s+/).length > 6) return false;
	const up = normaliseHeadingCase(t);
	return /^[A-Z0-9’'\-& ]+$/.test(up);
}

const RUN_IN_HEADS = [
	"PSYKANA MALIFICA",
	"IMPERIAL CRIMES",
	"SECTOR AND PLANETARY CRIMES",
	"ECCLESIASTICAL CRIMES",
	"COMMON PUNISHMENTS IN THE CALIXIS SECTOR",
	"EXAMPLE PLANETS",
	"THE COLD TRADE",
	"PERILS OF THE COLD TRADE",
	"THE DISCIPLES OF THULE",
	"HOUSE KRIN",
	"HOUSE KRIN CLERK",
	"HOUSE KRIN QUAESTOR",
	"THE KASBALLICA MISSION",
	"THE BLESSED APOSTLES OF SAINT ASCELINE",
	"THE INQUISITION",
	"THE CORTELAX CONFEDERACY",
	"THE CONFEDERACY’S FOUNDATION",
	"THE CONFEDERACY’S FLEET",
	"SALVATORUM LABORUS",
	"THE MISSION OF JUVIAL ROSEN",
	"MISSIONARIES IN THE EXPANSE",
	"PATH OF INVASION",
	"PHYSIOLOGY",
	"SOCIETY",
	"THE ALENIC DEPTHS",
	"THE RAK’GOL COME",
	"RAK’GOL WAR VESSELS",
	"ABOMINATIONS AND THE YU’VATH",
	"MAKING DEALS WITH THE STRYXIS",
	"KINDREDS AND KROOT EXPLORERS",
	"AGENTS OF HOUSE KRIN",
	"ENDEAVOUR COMPONENTS",
	"PROMISE OF SEDITION",
	"SENDAK VOLTRASSE",
	"SOPHI ADRIANIS’ MISADVENTURE",
];
/** Longest-first so "HOUSE KRIN CLERK" wins over "HOUSE KRIN". */
const RUN_IN_HEADS_SORTED = [...RUN_IN_HEADS].sort((a, b) => b.length - a.length);

/** Page HTML: verbatim paragraphs, with printed run-in headings as <h3>. */
function toHtml(section: Section): string {
	const paras = [...section.paragraphs];
	if (paras.length > 0) {
		const first = paras[0];
		if (first.startsWith(section.name)) {
			const rest = first.slice(section.name.length).trim();
			if (rest) paras[0] = rest;
			else paras.shift();
		}
	}
	// Restore text the heading line interrupted (see INTERRUPTED_HEADS).
	const fix = INTERRUPTED_HEADS[section.name];
	if (fix && paras[0]?.startsWith(fix[0])) {
		paras[0] = fix[1] + paras[0].slice(fix[0].length);
	}
	const out: string[] = [];
	for (const p of paras) {
		// A paragraph that is only a KNOWN printed run-in heading becomes <h3>.
		// The heuristic guess is deliberately not used here: the text layer's
		// small-caps render as arbitrary capital patterns and guessing promoted
		// sentence fragments ("Crimes", "of", "with") to headings. Only the
		// curated list is trusted; everything else stays prose.
		const bare = p.replace(/[.]$/, "").trim();
		const bareUp = normaliseHeadingCase(bare);
		if (RUN_IN_HEADS.includes(bareUp)) {
			out.push(`<h3>${displayHeading(bare)}</h3>`);
			continue;
		}
		// A heading leading a longer paragraph is split off (the heading must be
		// followed by a sentence start, not another heading word like
		// "HOUSE KRIN CLERK").
		const lead = RUN_IN_HEADS_SORTED.find((h) => bareUp.startsWith(`${h} `));
		if (lead) {
			const rest = bare.slice(lead.length).trim();
			if (!isHeadingRun(rest)) {
				out.push(`<h3>${displayHeading(bare.slice(0, lead.length))}</h3>`);
				out.push(`<p>${rest}</p>`);
				continue;
			}
		}
		out.push(`<p>${p}</p>`);
	}
	// Join a paragraph that continues the previous PARAGRAPH's sentence (a
	// column break can leave the tail as its own <p>). Never joins across an
	// <h3>: the heading must stay where it is.
	const joined: string[] = [];
	for (const el of out) {
		const pm = /^<p>([a-z][\s\S]*)<\/p>$/.exec(el);
		const prev = joined[joined.length - 1];
		if (pm && prev?.startsWith("<p>") && prev.endsWith("</p>")) {
			const prevText = prev.slice(3, -4);
			if (!/[.!?][\u201d"')]?$/.test(prevText.trim())) {
				joined[joined.length - 1] = `<p>${prevText} ${pm[1]}</p>`;
				continue;
			}
		}
		joined.push(el);
	}
	return joined.join("\n");
}

let added = 0;
let merged = 0;
let skipped = 0;
for (const section of sections) {
	const merge = MERGE_INTO[section.name];
	if (merge) {
		const host = docs.find((d) => d.name === merge.journal);
		if (!host) throw new Error(`no journal "${merge.journal}" for ${section.name}`);
		const page = host.pages.find((p) => p.name === merge.page);
		if (!page) throw new Error(`no page "${merge.page}" in ${merge.journal}`);
		if ((page.text ?? "").includes(`<h3>${section.name}</h3>`)) {
			console.log(`[lore] SKIP already merged "${section.name}"`);
			skipped += 1;
			continue;
		}
		// Merge as an <h3> section under the existing page, with a cite line.
		const body = toHtml(section);
		const side = sidebarsHtml(section.sidebars);
		page.text =
			`${page.text ?? ""}\n<h3>${section.name}</h3>\n${body}\n${side}\n` +
			`<p><em>Source: ${merge.source}</em></p>`;
		merged += 1;
		continue;
	}
	const journal = docs.find((d) => d.name === section.journal);
	if (!journal) {
		const created = NEW_JOURNALS[section.journal];
		if (!created) throw new Error(`no journal "${section.journal}" in ${OUT}`);
		docs.push({
			name: section.journal,
			ownership: created.ownership,
			pages: [],
		});
	}
	const host = docs.find((d) => d.name === section.journal);
	if (!host) throw new Error(`no journal "${section.journal}" in ${OUT}`);
	host.pages ??= [];
	if (host.pages.some((p) => p.name === section.name)) {
		console.log(`[lore] SKIP existing page "${section.name}"`);
		skipped += 1;
		continue;
	}
	host.pages.push({
		name: section.name,
		text: `${toHtml(section)}\n${sidebarsHtml(section.sidebars)}`.trim(),
		source: section.source,
	});
	added += 1;
}

const { stringify } = yaml;
writeFileSync(OUT, stringify(docs, { lineWidth: 100 }));
console.log(
	`[lore] appended ${added} page(s), merged ${merged}, skipped ${skipped} -> ${OUT}`,
);
