/**
 * Pack-read guard (bead 0qyi) — stops the hdn7 regression class.
 *
 * THE FAILURE THIS PREVENTS (2026-10-22 CI red): bead hdn7's pack-coverage
 * suite in src/roguetrader/rules/afflictions.test.ts carried a COMMENT saying
 * it skipped when the private compendia clone is absent, but never wired
 * `test.skipIf`. It therefore passed in this checkout — packs present, which
 * is all the pre-commit hook ever sees — and failed in packless Forgejo CI.
 *
 * The pre-commit hook cannot catch that class by running tests: it runs WITH
 * packs present, so it executes a SUPERSET of what CI runs and a
 * pack-absence-only failure is invisible to it. This guard is static, so it
 * gives the same verdict in both places, and it is cheap enough to keep the
 * hook fast.
 *
 * THE RULE: a test file under src/ or utils/ that reads a `src/packs` path AT
 * RUNTIME must also declare a pack guard. Accepted guard shapes (the ones the
 * tree already uses):
 *
 *   const HAS_PACKS = existsSync(PACK_ROOT);          // the guard itself
 *   describe.skipIf(!HAS_PACKS)(...)                  // ... used here
 *   test.skipIf(!existsSync(MUTATION_PACK))(...)      // rules/origins style
 *
 * A top-level `existsSync` check is the guard, not a violation — the failure
 * mode is a runtime read with NO guard ANYWHERE in the file. A comment that
 * merely CLAIMS the skip (hdn7) is not a guard.
 *
 * WHY STATIC AND NOT GREP: comments and fixture strings are full of
 * `src/packs` mentions that are not reads (`utils/changesets.test.ts` asserts
 * that a changeset body mentioning packs is refused; `utils/compendia.test.ts`
 * pins the manifest path constant). The scanner blanks comments and the
 * CONTENTS of string/template literals — keeping byte offsets — so only
 * genuine read calls and module specifiers are considered.
 *
 * KNOWN LIMITS (these are false NEGATIVES only; the guard errs towards
 * silence): a path handed to a helper (`loadPacks(PACK_ROOT)`) and read inside
 * that helper is not traced, and the `src/packs` clone itself is not scanned —
 * it is a separate private repository whose suites only exist where the packs
 * do, so a pack-absence failure is impossible there.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const ROOTS = ["src", "utils"];
/** The private compendia clone: a different repo, not our test surface. */
const PACKS_REPO = path.join("src", "packs");

/** Paths that point at the private compendia clone. */
const PACK_PATH = /(?:^|[./\\])src[/\\]packs(?:[/\\]|$)/;
/** The bare form used from inside src/ (`packs/rogue_trader/...`). */
const RELATIVE_PACK_PATH =
	/(?:^|[./\\])packs[/\\](?:rogue_trader|dark_heresy_2e)(?:[/\\]|$)/;

/** Calls that touch the filesystem at runtime. */
const READ_CALL =
	/\b(?:readFileSync|readFile|readdirSync|readdir|existsSync|exists|statSync|lstatSync|readlinkSync|realpathSync|opendirSync|createReadStream|Bun\.file)\s*\(/g;

/** `const X = ...` — used to follow pack paths into local constants. */
const DECLARATION =
	/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::(?:(?!=>)[^=;\n])*)?=\s*/g;

/**
 * A pack guard: `skipIf` gated on an `existsSync` check or on a `HAS_*`
 * boolean (which every suite derives from one). Deliberately narrow — a
 * `skipIf` on an unrelated flag must not count as guarding pack reads.
 */
const PACK_GUARD =
	/\b(?:skipIf|skipUnless|runIf)\s*\(\s*!?\s*(?:existsSync\s*\(|\bHAS_[A-Z0-9_]+\b|\bhas[A-Z][A-Za-z0-9]*\b)/;

type Literal = { start: number; end: number; text: string };
type Read = { line: number; what: string };
type Analysis = { reads: Read[]; guarded: boolean };

/**
 * Blank comments and the CONTENTS of string/template literals, preserving
 * byte offsets, and report each literal's text.
 *
 * A read call written inside a fixture string (this file's own negative test,
 * utils/changesets.test.ts) is therefore invisible as a call, while a real
 * `readFileSync("src/packs/...")` still leaves its path literal to be found.
 * Template interpolations (`${...}`) stay as code so `${PACK_ROOT}/ships/x`
 * keeps resolving to the constant.
 */
function scan(source: string): { code: string; literals: Literal[] } {
	const chars = source.split("");
	const literals: Literal[] = [];
	const blank = (from: number, to: number) => {
		for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++) {
			if (chars[i] !== "\n") chars[i] = " ";
		}
	};
	const push = (from: number, to: number) => {
		literals.push({ start: from, end: to, text: source.slice(from, to) });
		blank(from, to);
	};

	// Characters after which a `/` starts a regex literal rather than division.
	const regexPreceders = new Set([
		"",
		"(",
		",",
		"=",
		":",
		";",
		"[",
		"!",
		"&",
		"|",
		"?",
		"{",
		"}",
		"+",
		"-",
		"*",
		"%",
		"<",
		">",
		"~",
		"^",
	]);

	/** Walk code; with `interpolation`, stop past the closing `}`. */
	function walk(from: number, interpolation: boolean): number {
		let i = from;
		let braces = 0;
		let prev = "";
		while (i < source.length) {
			const c = source[i];
			const next = source[i + 1];
			if (interpolation) {
				if (c === "{") braces++;
				else if (c === "}") {
					if (braces === 0) return i + 1;
					braces--;
				}
			}
			if (c === "/" && next === "/") {
				let j = source.indexOf("\n", i);
				if (j === -1) j = source.length;
				blank(i, j);
				i = j;
				continue;
			}
			if (c === "/" && next === "*") {
				let j = source.indexOf("*/", i + 2);
				j = j === -1 ? source.length : j + 2;
				blank(i, j);
				i = j;
				continue;
			}
			if (c === '"' || c === "'") {
				let j = i + 1;
				while (j < source.length) {
					if (source[j] === "\\") {
						j += 2;
						continue;
					}
					if (source[j] === c) {
						j++;
						break;
					}
					if (source[j] === "\n") break;
					j++;
				}
				push(i + 1, Math.max(i + 1, j - 1));
				prev = c;
				i = j;
				continue;
			}
			if (c === "`") {
				let j = i + 1;
				let segment = j;
				while (j < source.length) {
					if (source[j] === "\\") {
						j += 2;
						continue;
					}
					if (source[j] === "`") break;
					if (source[j] === "$" && source[j + 1] === "{") {
						push(segment, j);
						j = walk(j + 2, true);
						segment = j;
						continue;
					}
					j++;
				}
				push(segment, Math.min(j, source.length));
				prev = "`";
				i = j + 1;
				continue;
			}
			if (c === "/" && regexPreceders.has(prev)) {
				let j = i + 1;
				let inClass = false;
				while (j < source.length) {
					const ch = source[j];
					if (ch === "\\") {
						j += 2;
						continue;
					}
					if (ch === "\n") break;
					if (ch === "[") inClass = true;
					else if (ch === "]") inClass = false;
					else if (ch === "/" && !inClass) {
						j++;
						break;
					}
					j++;
				}
				blank(i, j);
				prev = "/";
				i = j;
				continue;
			}
			if (!/\s/.test(c)) prev = c;
			i++;
		}
		return i;
	}

	walk(0, false);
	return { code: chars.join(""), literals };
}

function isPackPath(text: string): boolean {
	return PACK_PATH.test(text) || RELATIVE_PACK_PATH.test(text);
}

/** Index of the `)` matching the `(` at `open`. */
function matchingParen(code: string, open: number): number {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (code[i] === "(") depth++;
		else if (code[i] === ")") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return code.length;
}

/** End of a variable initializer: `;` or a newline that ends the expression. */
function initializerEnd(code: string, from: number): number {
	const continues = new Set([
		"=",
		"+",
		"-",
		"*",
		"/",
		"%",
		"&",
		"|",
		"?",
		":",
		",",
		"(",
		".",
		"[",
		"{",
	]);
	let depth = 0;
	for (let i = from; i < code.length; i++) {
		const c = code[i];
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") {
			if (depth === 0) return i;
			depth--;
		} else if (depth === 0 && c === ";") return i;
		else if (depth === 0 && c === "\n") {
			const last = code.slice(from, i).trimEnd().slice(-1);
			if (!continues.has(last)) return i;
		}
	}
	return code.length;
}

/** Does `[from, to)` contain a packs path literal or a known pack alias? */
function hasPackReference(
	code: string,
	from: number,
	to: number,
	packLiterals: Literal[],
	aliases: Set<string>,
): boolean {
	if (packLiterals.some((l) => l.start >= from && l.end <= to)) return true;
	const text = code.slice(from, to);
	for (const name of aliases) {
		if (new RegExp(`\\b${name}\\b`).test(text)) return true;
	}
	return false;
}

/** Static analysis of one test file's source. */
function analyze(source: string): Analysis {
	const { code, literals } = scan(source);
	const packLiterals = literals.filter((literal) => isPackPath(literal.text));
	const lineOf = (index: number) => code.slice(0, index).split("\n").length;

	// Constants bound to a packs path, directly or through another constant
	// (`const dir = \`src/packs/extracted-text/${book}\`` in source-pages).
	const aliases = new Set<string>();
	const declarations = [...code.matchAll(DECLARATION)].map((match) => {
		const from = (match.index ?? 0) + match[0].length;
		return { name: match[1], from, to: initializerEnd(code, from) };
	});
	for (let round = 0; round < 3; round++) {
		for (const { name, from, to } of declarations) {
			if (aliases.has(name)) continue;
			if (hasPackReference(code, from, to, packLiterals, aliases)) {
				aliases.add(name);
			}
		}
	}

	const reads: Read[] = [];
	const add = (line: number, what: string) => {
		if (reads.some((read) => read.line === line && read.what === what)) return;
		reads.push({ line, what });
	};

	for (const match of code.matchAll(READ_CALL)) {
		const index = match.index ?? 0;
		const open = index + match[0].length - 1;
		const close = matchingParen(code, open);
		const args = code.slice(open + 1, close);
		const literal = packLiterals.find((l) => l.start > open && l.end <= close);
		const alias = [...aliases].find((name) =>
			new RegExp(`\\b${name}\\b`).test(args),
		);
		if (!literal && !alias) continue;
		add(lineOf(index), literal ? literal.text : (alias ?? ""));
	}

	// Module-level reads: `from "src/packs/..."`, `import("...")`, `require("...")`.
	for (const literal of packLiterals) {
		const before = code.slice(
			Math.max(0, literal.start - 60),
			Math.max(0, literal.start - 1),
		);
		if (/\b(?:from|import|require)\s*\(?\s*$/.test(before)) {
			add(lineOf(literal.start), literal.text);
		}
	}

	return { reads, guarded: PACK_GUARD.test(code) };
}

/** Every `*.test.ts` under `dir`, skipping the private packs clone. */
function testFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (path.normalize(full) === path.normalize(PACKS_REPO)) continue;
			out.push(...testFiles(full));
		} else if (full.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

describe("pack-read guard (bead 0qyi)", () => {
	test("every suite that reads src/packs at runtime carries a pack guard", () => {
		const files = ROOTS.flatMap(testFiles).sort();
		// Guard the guard: if the walk or the detector broke, the assertion
		// below would pass vacuously.
		expect(files.length).toBeGreaterThan(50);

		const analysed = files.map((file) => ({
			file,
			...analyze(readFileSync(file, "utf8")),
		}));
		const readers = analysed.filter((result) => result.reads.length > 0);
		expect(readers.length).toBeGreaterThan(5);

		const offenders = analysed
			.filter((result) => result.reads.length > 0 && !result.guarded)
			.map(
				(result) =>
					`${result.file}:${result.reads[0].line} reads ${result.reads[0].what} with no skipIf/existsSync guard`,
			);
		expect(offenders).toEqual([]);
	});

	test("the detector catches an unguarded packs read (the hdn7 shape)", () => {
		// The regression exactly: a comment CLAIMING the skip, a top-level pack
		// path, and a bare read with no test.skipIf/test.describe guard.
		const fixture = `
import { existsSync, readFileSync } from "node:fs";
import { test } from "bun:test";

// Pack-driven guard: skipped when the pack is absent (never wired: hdn7).
const MUTATION_PACK = "src/packs/rogue_trader/afflictions/mutations.yaml";

test("every mutation names a procedure", () => {
	const docs = readFileSync(MUTATION_PACK, "utf8");
	expect(docs.length).toBeGreaterThan(0);
});
`;
		const result = analyze(fixture);
		expect(result.reads.length).toBe(1);
		expect(result.reads[0].line).toBe(9);
		expect(result.guarded).toBe(false);
	});

	test("the guarded shapes pass", () => {
		const viaHAS = `
import { existsSync, readFileSync } from "node:fs";
import { describe } from "bun:test";
const PACK_ROOT = "src/packs/rogue_trader";
const HAS_PACKS = existsSync(PACK_ROOT);
describe.skipIf(!HAS_PACKS)("pack", () => {
	const docs = readFileSync(\`\${PACK_ROOT}/npcs/npcs.yaml\`, "utf8");
});
`;
		const viaSkipIfExists = `
import { existsSync, readFileSync } from "node:fs";
import { test } from "bun:test";
const MUTATION_PACK = "src/packs/rogue_trader/afflictions/mutations.yaml";
const packTest = test.skipIf(!existsSync(MUTATION_PACK));
packTest("mutations", () => {
	readFileSync(MUTATION_PACK, "utf8");
});
`;
		for (const fixture of [viaHAS, viaSkipIfExists]) {
			const result = analyze(fixture);
			expect(result.reads.length).toBeGreaterThan(0);
			expect(result.guarded).toBe(true);
		}
	});

	test("a packs path built through a local constant is still a read", () => {
		// The utils/source-pages.test.ts shape: readdirSync on a variable whose
		// initializer is a template literal into the dumps.
		const fixture = `
import { readdirSync } from "node:fs";
function loadBook(book: string) {
	const dir = \`src/packs/extracted-text/\${book}\`;
	return readdirSync(dir);
}
`;
		const result = analyze(fixture);
		expect(result.reads.length).toBe(1);
		expect(result.guarded).toBe(false);
	});

	test("a bare packs mention in a comment or fixture string is not a read", () => {
		// utils/changesets.test.ts and utils/bump-release-manifest.test.ts
		// assert ON pack paths; those mentions must never look like reads.
		const fixture = `
import { expect, test } from "bun:test";

// Pack data lives in src/packs/rogue_trader (machine-local, never shipped).
test("refuses a consumed body referencing src/packs", () => {
	const body = "Added npcs to src/packs/rogue_trader.";
	expect(isPackReference(body)).toBe(true);
});
`;
		const result = analyze(fixture);
		expect(result.reads).toEqual([]);
	});
});
