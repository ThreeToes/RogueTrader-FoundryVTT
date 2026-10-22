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
				/(?:^|\n)\s*(?:window)?classes:\s*\[([^\]]*)\]/g,
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
		const reported = missing.filter((m) => !allowlist.some((a) => m.startsWith(a)));
		expect(reported).toEqual([]);
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