/**
 * Item-sheet template input-type guard (bead g7j0).
 *
 * Foundry's ApplicationV2 #parsePartHTML assigns input values in the DOM, and
 * a DOM <input type="number"> REJECTS any non-numeric value with
 * 'The specified value "X" cannot be parsed, or is out of range'. A
 * type="number" input must therefore be backed by a NumberField, and every
 * string/book-notation field must render as text (or a select).
 *
 * The live bug this guards: weapon-data.hbs rendered `system.reload` (book
 * notation "Full", "2 Full", "Half", "—", "N/A", "Free") as type="number", so
 * opening a weapon whose reload is non-numeric — most of the arsenal — logged
 * a console parse error from Foundry core on sheet open.
 *
 * STRING_FIELDS lists the string-notation item fields by their input `name`.
 * Extend it whenever a new book-notation StringField gets a sheet input.
 * (Name matching is exact, so ShipComponent's numeric `system.range.min` /
 * `system.range.max` are not confused with the weapon's string `system.range`.)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const ITEM_TEMPLATE_ROOT = "template/sheet/item";

/** Fields that are deliberately StringFields carrying book notation. */
const STRING_FIELDS: ReadonlySet<string> = new Set([
	// Weapon: metres ("90"), a formula ("SBx3") or "—" (data/item/weapon.ts).
	"system.range",
	// Ranged weapon reload time in book notation (data/item/ranged-weapon.ts).
	"system.reload",
]);

/** All item sheet templates (tabs/ + parts/), as relative paths. */
function itemTemplates(): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string): void => {
		for (const entry of readdirSync(join(ITEM_TEMPLATE_ROOT, dir)).sort()) {
			if (entry.endsWith(".hbs")) {
				out.push(prefix + entry);
			}
		}
	};
	walk("", "");
	walk("tabs", "tabs/");
	walk("parts", "parts/");
	return out;
}

/** Every <input> tag in a template body, as the tag text. */
function inputTags(source: string): string[] {
	return source.match(/<input\b[^>]*>/g) ?? [];
}

/** The `name` attribute of an input tag, if it carries one. */
function inputName(tag: string): string | null {
	return tag.match(/\bname="([^"]*)"/)?.[1] ?? null;
}

/** The `type` attribute of an input tag (text is the HTML default). */
function inputType(tag: string): string {
	return tag.match(/\btype="([^"]*)"/)?.[1] ?? "text";
}

describe("item sheet template input types (bead g7j0)", () => {
	test("the reload field renders as a text input carrying the value", () => {
		const source = readFileSync(
			join(ITEM_TEMPLATE_ROOT, "tabs/weapon-data.hbs"),
			"utf8",
		);
		const reloadInputs = inputTags(source).filter(
			(tag) => inputName(tag) === "system.reload",
		);
		expect(reloadInputs.length).toBe(1);
		expect(inputType(reloadInputs[0]!)).toBe("text");
		expect(reloadInputs[0]).toContain('value="{{source.system.reload}}"');
	});

	test("no string-notation field renders as type=number in any item sheet template", () => {
		for (const path of itemTemplates()) {
			const source = readFileSync(join(ITEM_TEMPLATE_ROOT, path), "utf8");
			for (const tag of inputTags(source)) {
				const name = inputName(tag);
				if (name === null || !STRING_FIELDS.has(name)) continue;
				expect(
					inputType(tag),
					`${path}: ${name} is a StringField (book notation); a ` +
						`type="${inputType(tag)}" input makes Foundry's parsePartHTML ` +
						`reject values like "Full". Render it as text or a select.`,
				).not.toBe("number");
			}
		}
	});
});