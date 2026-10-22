/**
 * Shared-component root guard (bead cmio.6).
 *
 * The system-neutral component layer css/40k-components.css keys its
 * selectors on the `.rt-component` root class (plus the test dialog's own
 * `.test-dialog-app` root — bead y8u3). Two shapes silently break that:
 *
 *   1. a new Application window without "rt-component" in its classes array
 *      — its shared components (chips, rules widgets) render unstyled, the
 *      kkne failure mode. The shared layer must instead be reachable: EVERY
 *      Application classes array in src carries the root.
 *   2. a rule added to the shared layer that carries a system slug or a
 *      bare unrooted selector — then DH2's bundle either leaks into RT or
 *      RT's rules reach a DH2 window (bead 3xi2, folded into cmio.6's
 *      acceptance criteria).
 *
 * Neither is visible without running Foundry, so these greps are the only
 * automated guard. They are cheap and they pin the convention documented in
 * the 40k-components.css header and docs/DESIGN-LANGUAGE.md.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const SRC = "src";
const SHARED_CSS = "css/40k-components.css";
const CSS_FILES = [
	"css/40k-components.css",
	"css/sheet-gear.css",
	"css/sheet-character.css",
	"css/chat-roll.css",
	"css/rules-app.css",
];

/** Root tokens a shared-layer selector may key on. */
const ALLOWED_ROOTS = [".rt-component", ".test-dialog-app"];

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

describe("shared component root (bead cmio.6)", () => {
	test("every Application classes array in src carries rt-component", () => {
		// Applications declare their window classes as a literal array on
		// DEFAULT_OPTIONS (`classes:`) or, for the branding-shaped test dialog,
		// `windowClasses:`. Each factory's literal covers every consumer built
		// through it (item sheets via itemSheetOptions, pickers via
		// PickerOptions, etc.). No exceptions currently: every window carries
		// the root (it is inert for systems that do not bundle the shared CSS).
		const allowlist: string[] = [];
		const missing: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(
				/(?:^|\n)\s*(?:windowClasses|classes):\s*\[([^\]]*)\]/g,
				// NOTE: `(?:window)?classes:` cannot match `windowClasses:` (after the
				// optional "window" comes capital C) — the alternation is deliberate;
				// the old optional-group form silently skipped branding-shaped
				// literals (found by the first rtk-window run, 2026-10-22).
			)) {
				const entries = match[1]
					.split(",")
					.map((e) => e.trim().replace(/^["']|["']$/g, ""))
					.filter(Boolean);
				if (!entries.includes("rt-component")) {
					const line = source.slice(0, match.index).split("\n").length;
					missing.push(`${file}:${line} — classes ${JSON.stringify(entries)}`);
				}
			}
		}
		// The shared layer is the ONLY reason for the root, so a window that
		// cannot carry it must be allowlisted here with the reason.
		const reported = missing.filter(
			(m) => !allowlist.some((a) => m.startsWith(a)),
		);
		expect(reported).toEqual([]);
	});

	test("every resizable window carries the rtk-window contract class (bead cmio.7)", () => {
		// The .rtk-window class (css/40k-components.css) is the shared
		// resize + clamp + scroll contract. A NEW resizable Application that
		// forgets it gets no floor fallback and no content scroll rule.
		//
		// BRITTLENESS (same literal-scan style as the test above): this is a
		// grep over source, not a runtime check — it (a) keys on the literal
		// `resizable: true` and the classes array on the SAME line, so a
		// multi-line array or a computed resizable value goes unseen, and
		// (b) is per-FILE: a window whose classes array is built elsewhere
		// (branding) escapes it. Known escape today: the test dialog's
		// windowClasses live in src/roguetrader/rules/test-dialog.ts while
		// `resizable: true` sits in src/ffg/infrastructure/foundry/
		// test-dialog.ts — both wired now (parent round, cmio.7), so the
		// allowlist is empty; computed classes arrays would still escape this
		// literal scan (documented brittleness).
		const allowlist: Array<{ file: string; reason: string }> = [];
		const missing: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			if (!source.includes("resizable: true")) continue;
			if (allowlist.some((a) => file.endsWith(a.file))) continue;
			const hasContractClass = [
				...source.matchAll(
					/(?:^|\n)\s*(?:windowClasses|classes):\s*\[([^\]]*)\]/g,
				),
			].some((m) =>
				m[1]
					.split(",")
					.map((e) => e.trim().replace(/^["']|["']$/g, ""))
					.includes("rtk-window"),
			);
			if (!hasContractClass) {
				missing.push(file);
			}
		}
		expect(missing).toEqual([]);
	});

	test("no RT css rule is defined in more than one RT css file (bead cmio.8 part 2)", () => {
		// The four duplicated primitives measured on cmio.8 (.sheet/.stat/
		// .inv-row/.chat) turned out to share CLASS NAMES, not identical rule
		// bodies — the only literally duplicated rule found (the creator
		// window-content scroll pair, sheet-gear.css copying
		// sheet-character.css) was REMOVED in that round, and no rule may
		// come back in two files. Two files redefining one rule make the
		// cascade order load-bearing for values that should live once.
		//
		// Comparison is root-token-normalized: .rogue-trader and
		// .rt-component are the same match for RT's windows (every consuming
		// application carries BOTH roots), so a selector moved between roots
		// is not a duplicate. BRITTLENESS: a naive CSS parser (comments
		// stripped, no nesting/@media handling — none used in these files).
		// It does NOT catch same-BODY-under-different-selector copies (e.g.
		// .psychic-row restating the .inv-row base) — that drift stays on
		// backlog bead io7g.
		const seen = new Map<string, Set<string>>();
		for (const file of CSS_FILES) {
			const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
			let buf = "";
			let depth = 0;
			for (const ch of css) {
				buf += ch;
				if (ch === "{") depth++;
				else if (ch === "}") {
					depth--;
					if (depth === 0) {
						const i = buf.indexOf("{");
						const sel = buf
							.slice(0, i)
							.trim()
							.replace(/\s+/g, " ")
							.replace(/\.rogue-trader/g, "~ROOT~")
							.replace(/\.rt-component/g, "~ROOT~");
						const decls = buf
							.slice(i + 1, -1)
							.split(";")
							.map((d) => d.trim().replace(/\s+/g, " "))
							.filter(Boolean)
							.sort();
						const key = `${sel} { ${decls.join("; ")} }`;
						if (!seen.has(key)) seen.set(key, new Set());
						seen.get(key)?.add(file);
						buf = "";
					}
				}
			}
		}
		const duplicated = [...seen.entries()]
			.filter(([, files]) => files.size > 1)
			.map(([key, files]) => `${[...files].join(" + ")}: ${key}`);
		expect(duplicated).toEqual([]);
	});

	test("every window floor is at or above the rtk-window contract fallback (review 2026-10-22)", () => {
		// The contract class sets fallback floors (320×240). Each window's own
		// clamp must be >= the fallback, otherwise the fallback silently raises
		// (or, worse, hides a deliberate smaller window). Selected the same way
		// the windows are: sheet.<slug>, the creators, the dialogs, the app —
		// the same inventory the classes-array scan covers. Non-window rules
		// (inner min-widths like .stat grids, inputs, chips) do not match the
		// pattern. BRITTLENESS: same as the rest of this file — literal scan,
		// no @media (none used).
		const windowSelector =
			/(\.sheet\.[a-z-]+|rules-app|test-dialog-app|[a-z-]+creator\b|advancement-dialog|picker\b)/;
		const floors: Array<{ rule: string; prop: string; px: number }> = [];
		for (const file of CSS_FILES) {
			const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
			let buf = "";
			let depth = 0;
			for (const ch of css) {
				buf += ch;
				if (ch === "{") depth++;
				else if (ch === "}") {
					depth--;
					if (depth === 0) {
						const i = buf.indexOf("{");
						const sel = buf.slice(0, i).trim().replace(/\s+/g, " ");
						const body = buf.slice(i + 1, -1);
						const withoutRoots = sel
							.replace(/\.(rogue-trader|rt-component)/g, "")
							.trim();
						if (windowSelector.test(sel) && !withoutRoots.includes(" ")) {
							for (const m of body.matchAll(/min-(width|height):\s*(\d+)px/g)) {
								floors.push({
									rule: `${file}: ${sel}`,
									prop: m[1] ?? "",
									px: Number(m[2] ?? 0),
								});
							}
						}
						buf = "";
					}
				}
			}
		}
		const tooSmall = floors.filter(
			(f) =>
				(f.prop === "width" && f.px < 320) ||
				(f.prop === "height" && f.px < 240),
		);
		expect(tooSmall).toEqual([]);
		// Sanity: the scan actually saw the window inventory (not zero rules).
		expect(floors.length).toBeGreaterThan(20);
	});

	test("the shared component layer is system-neutral and rooted", () => {
		const css = readFileSync(SHARED_CSS, "utf8");
		// Comments are stripped first: the file's own header documents the
		// convention and may NAME the system roots; the neutrality gate binds
		// the selectors and declarations that actually ship.
		const body = css.replace(/\/\*[\s\S]*?\*\//g, "");

		// (a) No system slug in any shipped selector or declaration — a DH2
		// bundle must be able to ship the file verbatim.
		expect(body).not.toContain("rogue-trader");

		// (b) No unrooted selector: every comma-separated selector of every
		// rule carries an allowed root token (bead 3xi2 — the shared layer's
		// rules must not reach windows that never opted in).
		const unrooted: string[] = [];
		const depth = { braces: 0 };
		let selector = "";
		for (const ch of body) {
			if (ch === "{") {
				const sel = selector.trim();
				for (const part of sel.split(",")) {
					const compound = part.trim();
					if (!compound) continue;
					if (!ALLOWED_ROOTS.some((root) => compound.includes(root))) {
						unrooted.push(compound);
					}
				}
				selector = "";
				depth.braces++;
			} else if (ch === "}") {
				selector = "";
				depth.braces--;
			} else {
				selector += ch;
			}
		}
		expect(unrooted).toEqual([]);
	});

	test("utils/css.ts bundles the shared layer first (components before skins)", () => {
		// Order is load-bearing: the shared chip base must precede every skin
		// file so per-site modifiers keep winning the cascade (cmio.6).
		const cssTs = readFileSync(path.join("utils", "css.ts"), "utf8");
		const shared = cssTs.indexOf("css/40k-components.css");
		expect(shared).toBeGreaterThan(-1);
		for (const skin of [
			"css/sheet-gear.css",
			"css/sheet-character.css",
			"css/chat-roll.css",
			"css/rules-app.css",
		]) {
			const at = cssTs.indexOf(skin);
			expect(at).toBeGreaterThan(-1);
			expect(shared).toBeLessThan(at);
		}
	});
});
