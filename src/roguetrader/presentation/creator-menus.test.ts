/**
 * Source-scan guard for the actor-directory creator menus (bead r5zz).
 *
 * creator-menus.ts touches `Hooks` at register time out of any Foundry world,
 * so the guard reads the source text instead (skills-domain /
 * advancement-dialog-guard precedent). It pins that the context-menu entries
 * use the v14 ContextMenuEntry field name (`visible`) and not the deprecated
 * `condition`, which logs a console deprecation warning on every actor
 * right-click since Foundry v14 (removal slated for v16).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
	"src/roguetrader/presentation/creator-menus.ts",
	"utf8",
);

describe("creator-menus source guard (bead r5zz)", () => {
	it("declares the entry predicate under the v14 `visible` field", () => {
		expect(SOURCE).toContain("visible?: (element?: HTMLElement) => boolean");
		expect(SOURCE).toContain("visible: (element) =>");
	});

	it("does not use the deprecated `condition` context-menu field", () => {
		expect(SOURCE).not.toMatch(/\bcondition\??\s*:/);
	});
});