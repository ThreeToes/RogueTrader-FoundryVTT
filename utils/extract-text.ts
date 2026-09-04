#!/usr/bin/env bun
/**
 * Quick PDF -> text extraction for the packs authoring workflow.
 *
 * Dumps per-page text files (plus combined full dumps and a manifest with a
 * source hash so re-extraction can be skipped) into extracted-text/, which is
 * gitignored - the source PDFs and extracted book text never leave the local
 * machine.
 *
 * Usage:
 *   bun utils/extract-text.ts <pdf...> [options]
 *
 * Options:
 *   --out <dir>     Output root (mandatory - never resolved relative to cwd)
 *   --pages <spec>  Page selection, e.g. "5-9,12" (default: all pages)
 *   --mode <m>      layout | raw | both (default: both)
 *   --rect x,y,w,h  Restrict extraction to a rectangle (pt) - the two-column
 *                   trick: run once per half-page column, x=0..318 / 319..638
 *                   on the core rulebook (636.976 x 838.551 pt), then stitch.
 *
 * Modes map to pdftotext: -layout keeps whitespace alignment (tables) while
 * raw follows PDF-internal order (column-aware, better for prose).
 *
 * Output layout per PDF:
 *   extracted-text/<stem>/page-0001.layout.txt
 *   extracted-text/<stem>/page-0001.raw.txt
 *   extracted-text/<stem>/full.layout.txt
 *   extracted-text/<stem>/full.raw.txt
 *   extracted-text/<stem>/manifest.json
 *
 * Not part of the build; run manually. Requires poppler-utils (pdftotext,
 * pdfinfo) on PATH.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

interface Options {
	outDir: string;
	pages?: string;
	mode: "layout" | "raw" | "both";
	rect?: { x: number; y: number; w: number; h: number };
}

function parseArgs(argv: string[]): { pdfs: string[]; options: Options } {
	const pdfs: string[] = [];
	let outDir: string | undefined;
	const options: Options = { outDir: "", mode: "both" };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case "--out":
				outDir = next;
				i++;
				break;
			case "--pages":
				options.pages = next;
				i++;
				break;
			case "--mode": {
				if (next !== "layout" && next !== "raw" && next !== "both") {
					throw new Error(`--mode must be layout|raw|both, got: ${next}`);
				}
				options.mode = next;
				i++;
				break;
			}
			case "--rect": {
				const parts = (next ?? "").split(",").map(Number);
				if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
					throw new Error(`--rect expects x,y,w,h, got: ${next}`);
				}
				options.rect = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
				i++;
				break;
			}
			default:
				if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
				pdfs.push(arg);
		}
	}
	if (pdfs.length === 0 || !outDir) {
		console.error(
			"usage: bun utils/extract-text.ts <pdf...> --out <dir> [--pages 5-9,12] [--mode layout|raw|both] [--rect x,y,w,h]",
		);
		if (pdfs.length > 0) {
			console.error("error: --out <dir> is mandatory");
		}
		process.exit(1);
	}
	options.outDir = resolve(outDir);
	return { pdfs, options };
}

/** Parse a page spec like "5-9,12" into an ascending unique page list. */
export function parsePageSpec(spec: string, pageCount: number): number[] {
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const range = trimmed.split("-");
		if (range.length === 2) {
			const [a, b] = range.map(Number);
			for (let p = Math.min(a, b); p <= Math.max(a, b); p++) pages.add(p);
		} else {
			pages.add(Number(trimmed));
		}
	}
	const valid = [...pages]
		.filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
		.sort((a, b) => a - b);
	if (valid.length === 0) {
		throw new Error(
			`page spec "${spec}" selects no valid pages (1-${pageCount})`,
		);
	}
	return valid;
}

/** Run a command, capturing stdout; throws with stderr on failure. */
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

/** Page count + basic metadata via pdfinfo. */
function pdfInfo(pdfPath: string): { pageCount: number; title?: string } {
	const out = run("pdfinfo", [pdfPath]);
	const pageCount = Number(out.match(/^Pages:\s+(\d+)$/m)?.[1]);
	if (!Number.isInteger(pageCount) || pageCount < 1) {
		throw new Error(`could not read page count from pdfinfo for ${pdfPath}`);
	}
	const title = out.match(/^Title:\s+(.*)$/m)?.[1]?.trim() || undefined;
	return { pageCount, title };
}

/** Extract one page in one mode. */
function extractPage(
	pdfPath: string,
	page: number,
	mode: "layout" | "raw",
	rect?: Options["rect"],
): string {
	const args = ["-f", String(page), "-l", String(page)];
	if (mode === "layout") args.push("-layout");
	if (rect)
		args.push(
			"-x",
			String(rect.x),
			"-y",
			String(rect.y),
			"-W",
			String(rect.w),
			"-H",
			String(rect.h),
		);
	args.push(pdfPath, "-");
	return run("pdftotext", args);
}

/** Extract a whole document in one mode (single pdftotext call, faster). */
function extractFull(
	pdfPath: string,
	mode: "layout" | "raw",
	firstPage: number,
	lastPage: number,
): string {
	const args: string[] = [];
	if (mode === "layout") args.push("-layout");
	if (firstPage > 1 || lastPage > 0)
		args.push("-f", String(firstPage), "-l", String(lastPage));
	args.push("-nopgbrk", pdfPath, "-");
	return run("pdftotext", args);
}

const PAGE_FILE = (page: number, mode: string) =>
	`page-${String(page).padStart(4, "0")}.${mode}.txt`;

export function extractPdf(pdfPath: string, options: Options): void {
	if (!existsSync(pdfPath)) throw new Error(`not found: ${pdfPath}`);
	const stem = basename(pdfPath)
		.replace(/\.pdf$/i, "")
		.replace(/[^\w.-]+/g, "_");
	const outRoot = resolve(options.outDir, stem);
	mkdirSync(outRoot, { recursive: true });

	const { pageCount, title } = pdfInfo(pdfPath);
	const pages = options.pages
		? parsePageSpec(options.pages, pageCount)
		: Array.from({ length: pageCount }, (_, i) => i + 1);
	const modes =
		options.mode === "both"
			? (["layout", "raw"] as const)
			: ([options.mode] as const);

	for (const mode of modes) {
		// Per-page files: the authoring unit (grep a single page, feed the
		// per-column rectangle trick, or paste rows into a pack YAML).
		for (const page of pages) {
			const text = extractPage(pdfPath, page, mode, options.rect);
			Bun.write(`${outRoot}/${PAGE_FILE(page, mode)}`, text);
		}
		// Combined dump for full-document greps (single pdftotext call).
		const first = pages[0];
		const last = pages[pages.length - 1];
		const full = extractFull(pdfPath, mode, first, last);
		Bun.write(`${outRoot}/full.${mode}.txt`, full);
	}

	// Manifest: enough to tell whether a re-extraction is needed.
	const bytes = statSync(pdfPath).size;
	const hash = new Bun.CryptoHasher("sha256")
		.update(readFileSync(pdfPath))
		.digest("hex");
	const manifest = {
		source: resolve(pdfPath),
		title,
		sizeBytes: bytes,
		sha256: hash,
		pageCount,
		pages,
		modes,
		rect: options.rect ?? null,
		extractedAt: new Date().toISOString(),
	};
	Bun.write(
		`${outRoot}/manifest.json`,
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	console.log(
		`[extract] ${basename(pdfPath)}: ${pages.length}/${pageCount} pages, modes=${modes.join("+")} -> ${outRoot}`,
	);
}

if (import.meta.main) {
	const { pdfs, options } = parseArgs(Bun.argv.slice(2));
	try {
		for (const pdf of pdfs) extractPdf(pdf, options);
	} catch (error) {
		console.error(`[extract] failed: ${(error as Error).message}`);
		process.exit(1);
	}
}
