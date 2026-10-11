/**
 * Template-root composition (bead w9sa.9).
 *
 * `templateRootFor` is the sibling-system path: a Dark Heresy system sharing
 * this tree composes its own template paths from one call instead of a string
 * hunt, and RT's own root stays byte-identical. The documented limitation — a
 * module-load constant, not an init-registered getter — is pinned here too, so
 * a future change that tries to make it dynamic has to reckon with it.
 */
import { describe, expect, test } from "bun:test";

import {
	DEFAULT_SYSTEM_ID,
	TEMPLATE_ROOT,
	templateRootFor,
} from "./template-root";
import { rtCore } from "./system-profile";

describe("templateRootFor", () => {
	test("composes a root for any system id", () => {
		expect(templateRootFor("dark-heresy-2e")).toBe(
			"systems/dark-heresy-2e/template/",
		);
		expect(templateRootFor("rogue-trader")).toBe(
			"systems/rogue-trader/template/",
		);
	});

	test("the sibling path composes the same shapes RT uses", () => {
		expect(`${templateRootFor("dark-heresy-2e")}chat/roll.hbs`).toBe(
			"systems/dark-heresy-2e/template/chat/roll.hbs",
		);
	});
});

describe("TEMPLATE_ROOT stays the Rogue Trader root", () => {
	test("unchanged, so RT's paths are byte-identical", () => {
		expect(DEFAULT_SYSTEM_ID).toBe("rogue-trader");
		expect(TEMPLATE_ROOT).toBe("systems/rogue-trader/template/");
	});

	test("rtCore's roll card is built from it", () => {
		expect(rtCore.rollCardTemplate).toBe(
			`${TEMPLATE_ROOT}chat/roll.hbs`,
		);
	});
});
