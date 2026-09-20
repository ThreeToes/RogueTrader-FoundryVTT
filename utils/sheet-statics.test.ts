/**
 * Sheet static-config guards (epic kof0, bead rt9z).
 *
 * Two shapes in `static DEFAULT_OPTIONS` / `static TABS` silently break the
 * class's static side against fvtt-types, producing TS2417 on every sheet that
 * has them:
 *
 *   1. `position: { height: "auto" }` — the literal widens to `string`, but
 *      fvtt-types wants `number | "auto" | undefined`. Needs `as const`.
 *   2. a tab entry without `cssClass` — fvtt-types' `Tab` requires it.
 *
 * Neither is visible without tsc, and tsc cannot be run over the sheet layer
 * yet (TS2589 + OOM, see bead rt9z), so these greps are the only automated
 * guard. They are cheap and they pin a fix that was verified by hand.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const SRC = "src";

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

describe("sheet static config (bead rt9z)", () => {
	test("no sheet widens position.height", () => {
		const bad: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/height:\s*"auto"\s*[,}]/g)) {
				const line = source.slice(0, match.index).split("\n").length;
				bad.push(`${file}:${line} — needs \`"auto" as const\``);
			}
		}
		expect(bad).toEqual([]);
	});

	test("every tab entry declares cssClass", () => {
		const bad: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			// A tab entry is a literal carrying both a group and a label.
			const entry = /\{[^{}]*group:\s*"[^"]*"[^{}]*label:\s*"[^"]*"[^{}]*\}/g;
			for (const match of source.matchAll(entry)) {
				if (match[0].includes("cssClass")) continue;
				const line = source.slice(0, match.index).split("\n").length;
				bad.push(`${file}:${line} — ${match[0].trim()}`);
			}
		}
		expect(bad).toEqual([]);
	});

	test("the guard can see the tabs it is guarding", () => {
		// Guard the guard: if the regex or the walk broke, both tests above
		// would pass vacuously.
		const withTabs = sourceFiles(SRC).filter((file) =>
			readFileSync(file, "utf8").includes("static TABS"),
		);
		expect(withTabs.length).toBeGreaterThanOrEqual(5);
	});
});
