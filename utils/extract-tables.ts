#!/usr/bin/env bun
/**
 * Table-column extraction for the packs authoring workflow.
 *
 * Driven by src/packs/.extraction-src/books.yaml (see src/packs/AGENTS.md). For each
 * selected page and each configured column rect, runs pdftotext -layout with
 * the rect and writes:
 *
 *   <out>/<page>-col<N>.txt   one column's layout text
 *   <out>/<page>.rows.txt     columns stitched line-by-line with " | "
 *   <out>/manifest.json       book key, pages, columns, extractedAt
 *
 * The stitched rows file is a CURATION DRAFT: line-by-line stitching works
 * when a table row occupies one text line per column (the common case for
 * armoury-style tables). Wrapped rows show up as short fragments — paste the
 * fragments into the pack YAML manually, or fix the column rects.
 *
 * Usage:
 *   bun utils/extract-tables.ts --book rt_core --pages 200-205 --out <dir>
 *
 * Options:
 *   --book <key>   Mandatory; key into books.yaml
 *   --pages <spec> Mandatory; e.g. "200-205" (same spec as extract-text.ts)
 *   --out <dir>    Mandatory output dir (never resolved relative to cwd)
 *   --books <path> Optional books.yaml override (default: src/packs/.extraction-src/books.yaml)
 *
 * Not part of the build; run manually. Requires poppler-utils on PATH.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import yaml from "yaml";

interface BookConfig {
	pdf: string;
	columns: Array<{ x: number; w: number }>;
}

interface Options {
	book: string;
	pages: string;
	outDir: string;
	booksPath: string;
}

const SCRIPT_DIR = dirname(import.meta.path);
const DEFAULT_BOOKS = resolve(
	SCRIPT_DIR,
	"../src/packs/.extraction-src/books.yaml",
);

function parseArgs(argv: string[]): Options {
	let book: string | undefined;
	let pages: string | undefined;
	let outDir: string | undefined;
	let booksPath = DEFAULT_BOOKS;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case "--book":
				book = next;
				i++;
				break;
			case "--pages":
				pages = next;
				i++;
				break;
			case "--out":
				outDir = next;
				i++;
				break;
			case "--books":
				booksPath = resolve(next ?? "");
				i++;
				break;
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}
	if (!book || !pages || !outDir) {
		console.error(
			"usage: bun utils/extract-tables.ts --book <key> --pages 5-9 --out <dir> [--books books.yaml]",
		);
		const missing = [!book && "--book", !pages && "--pages", !outDir && "--out"]
			.filter(Boolean)
			.join(", ");
		console.error(`error: missing mandatory flag(s): ${missing}`);
		process.exit(1);
	}
	return { book, pages, outDir: resolve(outDir), booksPath };
}

/** Line-by-line column stitch: " | "-join aligned lines, padding short columns. */
export function stitchColumns(columns: string[][]): string {
	const height = Math.max(0, ...columns.map((c) => c.length));
	const rows: string[] = [];
	for (let i = 0; i < height; i++) {
		rows.push(
			columns
				.map((col) => (col[i] ?? "").trim())
				.join(" | ")
				.replace(/(\s*\|\s*)+$/, ""),
		);
	}
	return `${rows.join("\n")}\n`;
}

/** Split layout text into non-empty lines (drops blanks and page furniture). */
export function layoutLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function run(command: string, args: string[]): string {
	const proc = Bun.spawnSync([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(
			`${command} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`,
		);
	}
	return proc.stdout.toString();
}

function expandTilde(path: string): string {
	if (!path.startsWith("~")) return resolve(path);
	const rest = path.slice(1).replace(/^\//, "");
	return resolve(homedir(), rest);
}

/** First 'Page size:' dimension pair from pdfinfo (e.g. 636.976 x 838.551 pts). */
export function pageHeightOf(pdfPath: string): number {
	const out = run("pdfinfo", [pdfPath]);
	const size = out.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m);
	if (!size)
		throw new Error(`could not read page size from pdfinfo for ${pdfPath}`);
	return Number(size[2]);
}

export function loadBook(booksPath: string, key: string): BookConfig {
	if (!existsSync(booksPath)) {
		throw new Error(`books manifest not found: ${booksPath}`);
	}
	const manifest = yaml.parse(readFileSync(booksPath, "utf8")) as {
		books?: Record<string, BookConfig>;
	};
	const book = manifest.books?.[key];
	if (!book) {
		throw new Error(
			`book "${key}" not in ${basename(booksPath)} (known: ${Object.keys(manifest.books ?? {}).join(", ")})`,
		);
	}
	if (!Array.isArray(book.columns) || book.columns.length === 0) {
		throw new Error(`book "${key}" has no columns configured`);
	}
	book.pdf = expandTilde(book.pdf);
	return book;
}

export function extractTablePages(
	book: BookConfig,
	pages: number[],
	outDir: string,
): void {
	if (!existsSync(book.pdf)) throw new Error(`not found: ${book.pdf}`);
	const pageHeight = pageHeightOf(book.pdf);
	mkdirSync(outDir, { recursive: true });
	for (const page of pages) {
		const pageArgs = ["-f", String(page), "-l", String(page)];
		const columns: string[][] = [];
		for (const [index, col] of book.columns.entries()) {
			const text = run("pdftotext", [
				...pageArgs,
				"-layout",
				// All four rect values are mandatory for poppler: -x/-W alone
				// silently yields empty output. -y 0/-H page height = full page.
				"-x",
				String(Math.round(col.x)),
				"-y",
				"0",
				"-W",
				String(Math.round(col.w)),
				"-H",
				String(Math.round(pageHeight)),
				book.pdf,
				"-",
			]);
			Bun.write(
				`${outDir}/page-${String(page).padStart(4, "0")}-col${index}.txt`,
				text,
			);
			columns.push(layoutLines(text));
		}
		Bun.write(
			`${outDir}/page-${String(page).padStart(4, "0")}.rows.txt`,
			stitchColumns(columns),
		);
	}
	const manifest = {
		source: book.pdf,
		columns: book.columns,
		pages,
		extractedAt: new Date().toISOString(),
	};
	Bun.write(
		`${outDir}/manifest.json`,
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		`[tables] ${basename(book.pdf)}: ${pages.length} pages x ${book.columns.length} columns -> ${outDir}`,
	);
}

if (import.meta.main) {
	try {
		const options = parseArgs(Bun.argv.slice(2));
		const book = loadBook(options.booksPath, options.book);
		// Page-count check via pdfinfo so a bad --pages spec fails early.
		const pageCount = Number(
			run("pdfinfo", [book.pdf]).match(/^Pages:\s+(\d+)$/m)?.[1],
		);
		const pages = (await import("./extract-text")).parsePageSpec(
			options.pages,
			pageCount,
		);
		extractTablePages(book, pages, options.outDir);
	} catch (error) {
		console.error(`[tables] failed: ${(error as Error).message}`);
		process.exit(1);
	}
}
