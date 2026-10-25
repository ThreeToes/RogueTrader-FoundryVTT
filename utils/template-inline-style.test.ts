/**
 * Inline style is a ONE-SURFACE allowance (bead zatz).
 *
 * The three data-driven meter fills (capacity-bar partial, inventory
 * encumbrance, advancement dialog) used to carry `style="width: {{pct}}%"`,
 * which put the fill's geometry outside the cascade: a theme could not retune
 * the meter and a reviewer could not find the declaration from the CSS. They
 * now pass the value as the `--rt-cb-fill` custom property and the `.cb-fill`
 * rule owns `width: var(--rt-cb-fill, 0)`.
 *
 * This pins both halves of that contract: no template may reintroduce an
 * inline `width:` (or any other inline declaration), and the CSS rule that
 * consumes the property must still declare the width. The CSS file is found
 * by scanning `css/` rather than hardcoded, because the sheet stylesheets get
 * reorganised and only the rule text is the contract.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const TEMPLATE_ROOT = "template";
const CSS_ROOT = "css";

function filesUnder(dir: string, suffix: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...filesUnder(full, suffix));
		else if (full.endsWith(suffix)) out.push(full);
	}
	return out;
}

/** The three templates that drive a fill width from sheet data. */
const FILL_TEMPLATES = [
	"template/shared/parts/capacity-bar.hbs",
	"template/sheet/actor/tabs/inventory.hbs",
	"template/sheet/actor/parts/advancement-dialog.hbs",
] as const;

/** The CSS rule that owns the fill width, wherever the stylesheets put it. */
function cbFillRule(): string {
	const owners: string[] = [];
	for (const file of filesUnder(CSS_ROOT, ".css")) {
		const css = readFileSync(file, "utf8");
		const match = css.match(/\.rogue-trader \.cb-fill \{[^}]*\}/);
		if (match) owners.push(match[0]);
	}
	expect(owners.length, "no single .rogue-trader .cb-fill rule").toBe(1);
	return owners[0] as string;
}

describe("inline style is a one-surface allowance (bead zatz)", () => {
	test("no template writes an inline width", () => {
		const bad: string[] = [];
		for (const file of filesUnder(TEMPLATE_ROOT, ".hbs")) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/style="[^"]*"/g)) {
				if (!match[0].startsWith('style="--rt-cb-fill: ')) {
					const line = source.slice(0, match.index).split("\n").length;
					bad.push(`${file}:${line} — ${match[0]}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	test("the three meter fills pass --rt-cb-fill", () => {
		for (const file of FILL_TEMPLATES) {
			const source = readFileSync(file, "utf8");
			expect(source, file).toContain('style="--rt-cb-fill: ');
			expect(source, file).not.toContain("style=\"width:");
		}
	});

	test("the .cb-fill rule owns the width declaration", () => {
		const rule = cbFillRule();
		expect(rule).toContain("width: var(--rt-cb-fill, 0)");
		// The fallback keeps a template that passes nothing (no capacity yet)
		// at zero rather than stretching the fill across the track.
		expect(rule).not.toContain("width: 100%");
	});
});
