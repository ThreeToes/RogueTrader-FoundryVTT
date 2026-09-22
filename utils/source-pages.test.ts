/**
 * Source-page matching (bead 9d0l).
 *
 * These tests pin the PASS ORDER, because the order IS the fix. The matcher
 * used to run one sequence with the standalone-heading pass first, which is
 * right for a prose pack and wrong for a table pack: for a weapon that has
 * both a prose mention and a stat row, the heading's page won. That is bead
 * nn96 — Autogun cited its heading page 120 when its stat row is printed on
 * 118 — and re-running the backfill would have undone its 36 hand corrections.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
	findMakerWrappedPage,
	findNicknamePage,
	findPage,
	isAdvanceRow,
	isCellMatch,
	isStatRow,
	isWrappedCellMatch,
	normalise,
	PASS_ORDER,
	type PageLines,
} from "./source-pages";

/** Build a 1-based pages array from `{filePage: lines}`. */
function makePages(byFilePage: Record<number, string[]>): PageLines[] {
	const max = Math.max(...Object.keys(byFilePage).map(Number));
	const pages: PageLines[] = [[]];
	for (let i = 1; i <= max; i++) pages[i] = byFilePage[i] ?? [];
	return pages;
}

describe("pass order (bead 9d0l)", () => {
	test("table packs try the table-row passes before the heading pass", () => {
		expect(PASS_ORDER.table[PASS_ORDER.table.length - 1]).toBe("heading");
		expect(PASS_ORDER.table).toEqual(["row", "clipped", "cell", "heading"]);
	});

	test("prose packs keep the heading pass first", () => {
		expect(PASS_ORDER.prose[0]).toBe("heading");
		expect(PASS_ORDER.prose).toEqual(["heading", "row", "clipped", "cell"]);
	});

	test("the two orders differ only in where heading sits", () => {
		expect([...PASS_ORDER.table].sort()).toEqual([...PASS_ORDER.prose].sort());
	});

	test("every pass appears exactly once in each order", () => {
		for (const order of Object.values(PASS_ORDER)) {
			expect(new Set(order).size).toBe(order.length);
			expect(order).toHaveLength(4);
		}
	});
});

describe("the Autogun regression (bead nn96)", () => {
	// The weapon has a prose heading on file page 121 (printed 120) and its
	// stat row on file page 119 (printed 118). The stat row is the cite.
	const pages = makePages({
		119: ["   Autogun                100m      S/3/–   1d10+3   ..."],
		121: ["Autogun"],
	});

	test("table mode cites the stat row, not the heading", () => {
		expect(findPage(pages, "Autogun", { minPage: 114, mode: "table" })).toBe(118);
	});

	test("prose mode still cites the heading — that is what it is for", () => {
		// This is not a bug: a prose pack's entry IS its heading. The bug was
		// using this order for table packs.
		expect(findPage(pages, "Autogun", { minPage: 114, mode: "prose" })).toBe(120);
	});

	test("the default mode is prose, matching the historical behaviour", () => {
		expect(findPage(pages, "Autogun", { minPage: 114 })).toBe(120);
	});

	test("a heading is still found in table mode when no row matches", () => {
		// The heading pass is moved, not removed: an entry with only a
		// heading must still get a cite.
		const headingOnly = makePages({ 121: ["Autogun"] });
		expect(findPage(headingOnly, "Autogun", { minPage: 114, mode: "table" })).toBe(
			120,
		);
	});
});

describe("findPage", () => {
	test("returns a PRINTED page: file page minus one", () => {
		const pages = makePages({ 119: ["   Lasgun   100m"] });
		expect(findPage(pages, "Lasgun", { minPage: 114, mode: "table" })).toBe(118);
	});

	test("respects the section floor", () => {
		const pages = makePages({ 100: ["   Lasgun   100m"], 119: ["   Lasgun   100m"] });
		expect(findPage(pages, "Lasgun", { minPage: 114, mode: "table" })).toBe(118);
	});

	test("returns null rather than guessing", () => {
		expect(findPage(makePages({ 119: ["   Something Else"] }), "Lasgun")).toBe(
			null,
		);
	});

	test("ignores names shorter than 3 characters", () => {
		expect(findPage(makePages({ 119: ["   Ab   x"] }), "Ab")).toBe(null);
	});

	test("skips career advance rows in the row pass", () => {
		// "<name>  <xp> Talent" is a career table, never the entry's own page.
		const pages = makePages({
			30: ["   Quick Draw        100 Talent"],
			150: ["   Quick Draw        100m"],
		});
		expect(
			findPage(pages, "Quick Draw", { minPage: 24, mode: "table" }),
		).toBe(149);
	});

	test("matches a wrapped name in a table cell", () => {
		// "Heavy Stubber" / "(Orthlack)" is one cell across two dump lines.
		const pages = makePages({ 119: ["   Heavy Stubber", "   (Orthlack)   100m"] });
		expect(
			findPage(pages, "Heavy Stubber (Orthlack)", { minPage: 114, mode: "table" }),
		).toBe(118);
	});

	test("matches a clipped name cell", () => {
		const pages = makePages({ 119: ["   Furious Assa"] });
		expect(
			findPage(pages, "Furious Assault", { minPage: 114, mode: "table" }),
		).toBe(118);
	});

	test("matches a name that is a heading with a trailing colon", () => {
		const pages = makePages({ 121: ["Autogun:"] });
		expect(findPage(pages, "Autogun", { minPage: 114, mode: "table" })).toBe(120);
	});
});

describe("normalise", () => {
	test("lowercases and collapses whitespace", () => {
		expect(normalise("  Heavy   Stubber  ")).toBe("heavy stubber");
	});

	test("maps the curly apostrophe to a space, like the dumps do", () => {
		// The dumps render the book's "Officer's Cutlass" as "Officer s
		// Cutlass". Applying the same rule to both sides makes them agree.
		expect(normalise("Officer's Cutlass")).toBe("officer s cutlass");
		expect(normalise("Officer’s Cutlass")).toBe("officer s cutlass");
		expect(normalise("Officer s Cutlass")).toBe("officer s cutlass");
	});

	test("drops dagger and asterisk footnote marks", () => {
		expect(normalise("Lasgun†")).toBe("lasgun");
		expect(normalise("Lasgun*")).toBe("lasgun");
	});
});

describe("isAdvanceRow", () => {
	test("flags career advance rows", () => {
		expect(isAdvanceRow("quick draw 100 talent")).toBe(true);
		expect(isAdvanceRow("awareness skill")).toBe(true);
	});

	test("does not flag a stat row", () => {
		expect(isAdvanceRow("autogun 100m s/3/– 1d10+3")).toBe(false);
	});
});

describe("isCellMatch", () => {
	test("matches a name between column gaps", () => {
		expect(isCellMatch("   Krak                    Thrown", "krak")).toBe(true);
	});

	test("does not match a name embedded in a longer word", () => {
		expect(isCellMatch("   Krakatoa Pattern", "krak")).toBe(false);
	});
});

describe("isWrappedCellMatch", () => {
	test("matches a name split across two lines", () => {
		expect(
			isWrappedCellMatch(["   Heavy Stubber", "   (Orthlack)   100m"], 0, "heavy stubber (orthlack)"),
		).toBe(true);
	});

	test("returns false at the last line", () => {
		expect(isWrappedCellMatch(["   Heavy Stubber"], 0, "heavy stubber")).toBe(
			false,
		);
	});
});

describe("isStatRow", () => {
	test("accepts a weapon stat row", () => {
		expect(isStatRow("   Boltgun   Basic  80m  S/3/– 1d10+4 X 2   18  Full")).toBe(
			true,
		);
	});

	test("rejects prose that mentions damage", () => {
		expect(isStatRow("Boltguns deal 1d10+4 damage at close range.")).toBe(false);
	});
});

describe("findMakerWrappedPage (bead r8rx)", () => {
	// The armoury tables render a made-up weapon as: name line, stat line, then
	// the maker in parentheses on its OWN line. Two entries can share a base
	// name and differ only by that maker, so the maker line is what tells them
	// apart — a name match alone cannot.
	const pages = makePages({
		50: [
			"   Boltgun",
			"      Basic  80m  S/3/– 1d10+4 X 2   18  Full  Tearing",
			"   (Footfall)",
			"   Boltgun",
			"      Basic  120m  S/3/– 1d10+9 X 4   30  Full  Reliable",
			"   (Archeotech)",
		],
	});

	test("distinguishes two entries that share a base name", () => {
		// Both are on the SAME page here, so the assertion that matters is that
		// each resolves at all rather than to null/ambiguous.
		expect(findMakerWrappedPage(pages, "Boltgun", "Footfall")).toBe(49);
		expect(findMakerWrappedPage(pages, "Boltgun", "Archeotech")).toBe(49);
	});

	test("a maker that appears on the wrong page does not match", () => {
		expect(findMakerWrappedPage(pages, "Boltgun", "Mars-pattern")).toBe(null);
	});

	test("returns null when the name and maker never sit in that order", () => {
		const wrongOrder = makePages({
			50: ["   (Footfall)", "   Boltgun", "      Basic  80m  1d10+4 X"],
		});
		expect(findMakerWrappedPage(wrongOrder, "Boltgun", "Footfall")).toBe(null);
	});

	test("returns null on ambiguity rather than guessing", () => {
		// Two pages both carry the name/stat/maker shape.
		const twice = makePages({
			50: ["   Boltgun", "      Basic  80m  1d10+4 X", "   (Footfall)"],
			60: ["   Boltgun", "      Basic  80m  1d10+4 X", "   (Footfall)"],
		});
		expect(findMakerWrappedPage(twice, "Boltgun", "Footfall")).toBe(null);
	});

	test("short names and makers are refused", () => {
		expect(findMakerWrappedPage(pages, "Ab", "Footfall")).toBe(null);
		expect(findMakerWrappedPage(pages, "Boltgun", "Ab")).toBe(null);
	});
});

describe("findNicknamePage (bead r8rx)", () => {
	// The books name a signature weapon maker + model + quoted nickname while
	// the table prints a shortened label. The quoted word is the distinctive
	// token; the type word keeps it from matching an unrelated weapon.
	const pages = makePages({
		82: [
			"   Clovis Twist Pistol   Pistol  20m  S/–/– 1d10+4 E  0  1  Full",
			"   Clovis Mark IV Plasma Gun   Basic  90m  S/2/4  2d10+4 E  10",
		],
	});

	test("matches the shortened table label via the quoted nickname", () => {
		expect(findNicknamePage(pages, 'Clovis FP-14 "Twist" Pistol')).toBe(81);
	});

	test("the type word disambiguates a shared nickname", () => {
		// Same nickname, different weapon: only the type word separates them.
		const shared = makePages({
			82: [
				"   Clovis Twist Pistol   Pistol  20m  1d10+4 E",
				"   Clovis Twist Cannon   Heavy  60m  2d10+4 E",
			],
		});
		expect(findNicknamePage(shared, 'Clovis FP-14 "Twist" Pistol')).toBe(81);
	});

	test("returns null when the name has no quoted nickname", () => {
		expect(findNicknamePage(pages, "Clovis Twist Pistol")).toBe(null);
	});

	test("returns null when the nickname appears nowhere", () => {
		expect(findNicknamePage(pages, 'Clovis FP-14 "Absolution" Rifle')).toBe(null);
	});

	test("returns null on ambiguity rather than guessing", () => {
		const twice = makePages({
			82: ["   Clovis Twist Pistol   Pistol  20m  1d10+4 E"],
			92: ["   Clovis Twist Pistol   Pistol  20m  1d10+4 E"],
		});
		expect(findNicknamePage(twice, 'Clovis FP-14 "Twist" Pistol')).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Real-dump assertions. These run only where the private book dumps are
// staged (they are gitignored in both repos), so the public tree still passes.
// ---------------------------------------------------------------------------
const DUMPS = "src/packs/extracted-text/rt_core";
const REF = "src/packs/.extraction-src/weapons2-parsed.json";
const HAS_DUMPS = existsSync(DUMPS) && existsSync(REF);

function loadDumps(): PageLines[] {
	const pages: PageLines[] = [[]];
	for (let p = 1; p <= 401; p++) {
		const file = `${DUMPS}/page-${String(p).padStart(4, "0")}.layout.txt`;
		pages[p] = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
	}
	return pages;
}

describe.skipIf(!HAS_DUMPS)("against the real Core Rulebook dumps", () => {
	const pages = HAS_DUMPS ? loadDumps() : [];
	const ref: Array<{ name: string; page: number }> = HAS_DUMPS
		? JSON.parse(readFileSync(REF, "utf8"))
		: [];

	/** The backfill's own fallback: retry with the parenthetical stripped. */
	function cite(name: string, mode: "table" | "prose"): number | null {
		const direct = findPage(pages, name, { minPage: 114, mode });
		if (direct !== null) return direct;
		const base = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
		return base === name ? null : findPage(pages, base, { minPage: 114, mode });
	}

	test("table mode reproduces the hand-corrected nn96 cites", () => {
		// These are exactly the rows nn96 fixed by hand; the old heading-first
		// order got every one of them wrong.
		const corrected = new Map<string, number>([
			["Autogun", 118],
			["Lasgun", 118],
			["Laspistol", 118],
			["Stub Automatic", 118],
			["Stub Revolver", 118],
			["Hand Cannon", 118],
		]);
		for (const [name, want] of corrected) {
			expect(cite(name, "table")).toBe(want);
		}
	});

	test("table mode is far more accurate than prose mode", () => {
		// The measurement that justified the mode split. Bounds are loose
		// (>=) so a future improvement cannot break the test, but a REGRESSION
		// back to heading-first would fail it.
		const score = (mode: "table" | "prose") =>
			ref.filter((w) => cite(w.name, mode) === w.page - 1).length;
		const tableScore = score("table");
		const proseScore = score("prose");
		expect(tableScore).toBeGreaterThanOrEqual(96);
		expect(proseScore).toBeLessThanOrEqual(70);
		expect(tableScore).toBeGreaterThan(proseScore + 20);
	});

	test("the residual misses are the known name-collision rows", () => {
		// Documented, not hidden: short generic names (Krak, Plasma, Smoke)
		// collide with prose mentions and other weapons earlier in the book.
		// Fixing them needs the distinctive-token matcher from bead efmy, not
		// a pass reorder — pinning the list here means the residual cannot
		// grow unnoticed.
		const missed = ref
			.filter((w) => cite(w.name, "table") !== w.page - 1)
			.map((w) => w.name)
			.sort();
		expect(missed).toEqual([
			"Improvised",
			"Krak",
			"Photon Flash",
			"Plasma",
			"Smoke",
			"Virus",
		]);
	});
});

// ---------------------------------------------------------------------------
// Maker/nickname matchers against the real dumps (bead r8rx).
//
// These pin the ELEVEN corrections the new strategies produced. Each is a row
// the name-only matcher could not resolve at all, so without these the fix
// would rest on a one-off script run.
// ---------------------------------------------------------------------------
const MULTI_BOOKS = [
	"faith_and_coin",
	"hostile_acquisitions",
	"into_the_storm",
	"soul_reaver",
] as const;

const HAS_MULTI = MULTI_BOOKS.every((book) =>
	existsSync(`src/packs/extracted-text/${book}`),
);

/** Pages of a book, indexed by FILE page (index 0 unused). */
function loadBook(book: string): PageLines[] {
	const dir = `src/packs/extracted-text/${book}`;
	const numbers = readdirSync(dir)
		.filter((f) => /^page-\d+\.layout\.txt$/.test(f))
		.map((f) => Number(f.match(/\d+/)![0]));
	const max = Math.max(...numbers);
	const pages: PageLines[] = [[]];
	for (let p = 1; p <= max; p++) {
		const file = `${dir}/page-${String(p).padStart(4, "0")}.layout.txt`;
		pages[p] = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
	}
	return pages;
}

/** Printed page for a file page, read from that page's own footer. */
function footerPrinted(
	pages: readonly PageLines[],
	filePage: number,
): number | null {
	let printed: number | null = null;
	for (const line of pages[filePage] ?? []) {
		const m = line.trim().match(/^(\d{1,3})$/);
		if (m) printed = Number(m[1]);
	}
	return printed;
}

describe.skipIf(!HAS_MULTI)("maker/nickname matchers against the real dumps", () => {
	const books = new Map<string, PageLines[]>();
	if (HAS_MULTI) for (const b of MULTI_BOOKS) books.set(b, loadBook(b));

	test("the maker-on-its-own-line shape resolves the two Boltguns", () => {
		const pages = books.get("hostile_acquisitions")!;
		// Both entries share the base name "Boltgun" and differ only by the
		// maker line after the stat row. The pack cited 50 and 51; the rows are
		// both on printed 49.
		expect(findMakerWrappedPage(pages, "Boltgun", "Footfall")).toBe(49);		expect(findMakerWrappedPage(pages, "Boltgun", "Archeotech")).toBe(49);
		expect(findMakerWrappedPage(pages, "Bolt Pistol", "Footfall")).toBe(49);
		expect(findMakerWrappedPage(pages, "Bolt Carbine", "Ceres")).toBe(49);
		expect(findMakerWrappedPage(pages, "Shotgun", "Persecutor")).toBe(49);
	});

	test("the quoted nickname resolves the maker-named signature weapons", () => {
		const fc = books.get("faith_and_coin")!;
		expect(findNicknamePage(fc, 'Clovis FP-14 "Twist" Pistol')).toBe(81);
		expect(findNicknamePage(fc, 'Merovech Model 481 "Persuader" Lasgun')).toBe(81);
		expect(findNicknamePage(fc, 'Mars-pattern MkII "Scourge" Boltgun')).toBe(81);

		const its = books.get("into_the_storm")!;
		expect(findNicknamePage(its, 'Perinetus-pattern "Solo" Mark II Boltgun')).toBe(
			113,
		);
		expect(findNicknamePage(its, 'Zepherus Mark I "Beamer" Meltagun')).toBe(113);
		expect(findNicknamePage(its, 'Ryza-pattern "Wrath" Plasma Pistol')).toBe(113);
	});

	test("the derived pages agree with the page FOOTERS", () => {
		// The point of the whole exercise: not that the matcher returns a
		// number, but that the number is the page the row is actually printed
		// on. Where the book prints a footer, the two must agree.
		const cases: Array<[string, number | null, number]> = [
			[
				"hostile_acquisitions",
				findMakerWrappedPage(books.get("hostile_acquisitions")!, "Boltgun", "Footfall"),
				49,
			],
			[
				"into_the_storm",
				findNicknamePage(
					books.get("into_the_storm")!,
					'Perinetus-pattern "Solo" Mark II Boltgun',
				),
				113,
			],
		];
		for (const [book, derived, expected] of cases) {
			expect(derived, book).toBe(expected);
			// The stat row sits on FILE page (printed + 1); its footer confirms it.
			const printed = footerPrinted(books.get(book)!, expected + 1);
			if (printed !== null) expect(printed, `${book} footer`).toBe(expected);
		}
	});

	test("neither matcher invents an answer where there is none", () => {
		// These must stay null: a fabricated page is worse than an admitted gap.
		const fc = books.get("faith_and_coin")!;
		const sr = books.get("soul_reaver")!;
		expect(findNicknamePage(fc, "Lucius-pattern Mk22c Shotgun")).toBe(null);
		expect(findNicknamePage(sr, "Splinter Cannon")).toBe(null);
		expect(findMakerWrappedPage(fc, "No Such Weapon", "Nowhere")).toBe(null);
	});
});
