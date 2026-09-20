/**
 * fvtt-types subpath imports resolve (epic kof0, bead ihpm).
 *
 * 11 source files carried `import type { Actor } from "fvtt-types/documents"`
 * — a subpath the installed package does NOT export. TypeScript therefore
 * resolved `Actor` to an error type (i.e. `any`), which silently disabled type
 * checking of everything typed as `Actor` (every roll request, the ports, the
 * actor-view builder) and buried the real errors in a diagnostic everyone had
 * learned to read as noise.
 *
 * Nothing caught it because nothing runs tsc. This does: every fvtt-types
 * subpath used in the source must exist in the package's `exports` map.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const SRC = "src";
const PKG = "node_modules/fvtt-types/package.json";

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (full.endsWith(".ts")) out.push(full);
	}
	return out;
}

/**
 * Production sources only.
 *
 * The relative-import check must skip tests: architecture.test.ts embeds
 * synthetic import strings as fixtures (e.g. `"../application/rolls"` on a
 * fake path) and those are not imports at all.
 */
function productionFiles(dir: string): string[] {
	return sourceFiles(dir).filter((file) => !file.endsWith(".test.ts"));
}

/** The subpaths the installed fvtt-types actually exports ("." -> bare import). */
function exportedSubpaths(): Set<string> {
	const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
		exports?: Record<string, unknown>;
	};
	return new Set(Object.keys(pkg.exports ?? {}));
}

describe("fvtt-types imports (bead ihpm)", () => {
	test("every fvtt-types subpath used in the source is exported by the package", () => {
		const exported = exportedSubpaths();
		// Guard the guard: if the exports map were ever unreadable this test
		// would silently pass.
		expect(exported.size).toBeGreaterThan(0);

		const bad: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(
				/from\s+["'](fvtt-types(?:\/[^"']*)?)["']/g,
			)) {
				const spec = match[1];
				if (spec === "fvtt-types") continue; // the "." export
				const subpath = `./${spec.slice("fvtt-types/".length)}`;
				if (!exported.has(subpath)) {
					const line = source.slice(0, match.index).split("\n").length;
					bad.push(`${file}:${line} -> "${spec}" (no "${subpath}" export)`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	test("the historical trap stays fixed", () => {
		// `fvtt-types/documents` never existed; the Foundry types are globals.
		const offenders = sourceFiles(SRC).filter((file) =>
			readFileSync(file, "utf8").includes("fvtt-types/documents"),
		);
		expect(offenders).toEqual([]);
	});

	/**
	 * A relative import that does not resolve is invisible when it is TYPE-ONLY:
	 * the bundler erases it, so `bun run build` is happy, and the imported name
	 * silently becomes an error type (`any`) — which is exactly how
	 * `import type { Modifier } from "../../rules-engine/src/modifier"` in
	 * character-sheet.ts (one `../` short) disabled type checking of every
	 * Modifier in that file.
	 */
	test("every relative import resolves to a file", () => {
		const bad: string[] = [];
		let checked = 0;
		for (const file of productionFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
				const spec = match[1];
				checked += 1;
				const resolved = path.resolve(path.dirname(file), spec);
				const found = [
					resolved,
					`${resolved}.ts`,
					path.join(resolved, "index.ts"),
				].some((candidate) => existsSync(candidate));
				if (!found) {
					const line = source.slice(0, match.index).split("\n").length;
					bad.push(`${file}:${line} -> ${spec}`);
				}
			}
		}
		// Guard the guard: an empty or broken scan must not pass vacuously.
		expect(checked).toBeGreaterThan(400);
		expect(bad).toEqual([]);
	});
});
