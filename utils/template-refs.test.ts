/**
 * Template references resolve (epic kof0 follow-up).
 *
 * `verify:templates` checks the .hbs files ON DISK compile and render, but
 * nothing cross-checked the ~90 template paths referenced from TypeScript. A
 * typo there is a broken sheet or a broken chat card at runtime that build,
 * lint, verify:templates and the whole test suite all pass straight over —
 * Foundry only complains when the sheet or card is actually opened in play.
 *
 * This closes the loop: every `systems/rogue-trader/template/...hbs` string in
 * the source must resolve to a file under template/.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const SRC = "src";
const TEMPLATE_ROOT = "template";
const SYSTEM_PREFIX = "systems/rogue-trader/template/";

/** Every .ts file under src/, excluding tests (tests may use fake paths). */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

/** Template paths referenced as string literals in the source. */
function referencedTemplates(): Array<{ file: string; line: number; ref: string }> {
	const found: Array<{ file: string; line: number; ref: string }> = [];
	const re = new RegExp(`${SYSTEM_PREFIX}[\\w./-]+\\.hbs`, "g");
	for (const file of sourceFiles(SRC)) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(re)) {
			found.push({
				file,
				line: source.slice(0, match.index).split("\n").length,
				ref: match[0],
			});
		}
	}
	return found;
}

describe("template references (bead 83tl follow-up)", () => {
	test("every template path in the source exists on disk", () => {
		const refs = referencedTemplates();
		// Guard the guard: if the scanner finds nothing the assertion below
		// would pass vacuously.
		expect(refs.length).toBeGreaterThan(50);
		const missing = refs
			.filter(({ ref }) => {
				const rel = ref.slice(SYSTEM_PREFIX.length);
				return !existsSync(path.join(TEMPLATE_ROOT, rel));
			})
			.map(({ file, line, ref }) => `${file}:${line} -> ${ref}`);
		expect(missing).toEqual([]);
	});

	test("no template path uses a different prefix", () => {
		// A bare "template/..." or a wrong system id would resolve differently
		// in Foundry than it does on disk, so catch the drift here too.
		const wrongPrefix = sourceFiles(SRC)
			.flatMap((file) => {
				const source = readFileSync(file, "utf8");
				return [...source.matchAll(/["'`]([^"'`\s]*?)\/template\/[\w./-]+\.hbs/g)]
					.filter((m) => !m[1].endsWith("systems/rogue-trader"))
					.map(() => file);
			});
		expect([...new Set(wrongPrefix)]).toEqual([]);
	});
});
