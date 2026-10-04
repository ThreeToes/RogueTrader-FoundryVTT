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

// Bead nt34 F11: the ContextMenuEntry option TYPE moved to one shared place,
// consumed by both menu modules — the declared field now lives and is
// asserted there.
const SHARED_TYPE = readFileSync(
	"src/roguetrader/presentation/context-menu-entry.ts",
	"utf8",
);

describe("creator-menus source guard (bead r5zz)", () => {
	it("declares the entry predicate under the v14 `visible` field", () => {
		expect(SHARED_TYPE).toContain(
			"visible?: (element?: HTMLElement) => boolean",
		);
		expect(SOURCE).toContain("visible: (element) =>");
		// The menu consumes the shared ContextMenuEntryOption type, not a
		// module-local duplicate.
		expect(SOURCE).toContain('from "./context-menu-entry"');
	});

	it("does not use the deprecated `condition` context-menu field", () => {
		expect(SOURCE).not.toMatch(/\bcondition\??\s*:/);
	});
});