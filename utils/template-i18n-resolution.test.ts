/**
 * Sheet i18n RESOLUTION regression (reported 2026: "the translations aren't
 * resolving properly in any of the rogue trader sheets").
 *
 * The parity guards in src/roguetrader/i18n-key-parity.test.ts only prove a key
 * EXISTS somewhere in lang/*.json. They cannot prove a sheet's template ever
 * *composes a resolvable key*: Foundry's built-in `localize` helper is given
 * whatever the context supplies, and a key built at the wrong case — or a key
 * whose dict entry is missing entirely — renders its own literal text on the
 * sheet with no error anywhere. Two live instances of exactly that:
 *
 *  1. navigator-power.hbs built the mastery key from the SCHEMA's lowercase
 *     value (`NAVIGATOR_POWER.novice`), while every lang key is upper-snake
 *     (`NAVIGATOR_POWER.NOVICE`). Every read-only navigator power row showed
 *     the raw key string. Fixed by resolving the label in the sheet's
 *     `_prepareContext` (navigator-power-sheet.ts) — the same seam the
 *     characteristic label and the creator already use.
 *  2. `TYPES.Item.gearset` was registered as a sheet label
 *     (bootstrap/sheet-registry.ts) but existed in NONE of the four language
 *     files, so the gearset row in Foundry's sheet picker was a bare key.
 *
 * These tests render the REAL templates against the REAL lang/en.json through a
 * stub `localize` that marks any unresolved key loudly, then assert the marked
 * string never appears. A regression reintroducing either shape fails here
 * instead of silently shipping untranslated text to a world.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import Handlebars from "handlebars";

/** lang/en.json — the real, shipped English dictionary (flat key -> string). */
const en = JSON.parse(readFileSync("lang/en.json", "utf8")) as Record<
	string,
	string
>;

/**
 * A `localize` that behaves like Foundry's: returns the translation, or (as
 * Foundry does for a miss) the key itself — tagged so a test can detect it.
 */
function makeLocalize() {
	const unresolved = new Set<string>();
	const localize = (key: unknown): string => {
		const k = String(key ?? "");
		if (k === "" || en[k] === undefined) {
			unresolved.add(k);
			return k;
		}
		return en[k]!;
	};
	return { localize, unresolved };
}

/**
 * A helper set mirroring Foundry core + this system's own registrations
 * (src/roguetrader/sheet/handlebars.ts). `concat` matches the production helper
 * exactly, including dropping the trailing handlebars options object.
 */
function buildHandlebars(localize: (key: unknown) => string): ReturnType<typeof Handlebars.create> {
	const hb = Handlebars.create();
	hb.registerHelper("localize", localize as never);
	hb.registerHelper("concat", (...args: unknown[]) =>
		args
			.slice(0, -1)
			.filter((part) => part !== undefined && part !== null)
			.join(""),
	);
	hb.registerHelper("ifThen", (cond: unknown, a: unknown, b: unknown) =>
		cond ? a : b,
	);
	hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);
	hb.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
	hb.registerHelper("selectOptions", () => new Handlebars.SafeString(""));
	hb.registerHelper("checked", (v: unknown) =>
		v ? new Handlebars.SafeString('checked="checked"') : "",
	);
	return hb;
}

describe("navigator power sheet: the mastery label resolves", () => {
	const source = readFileSync(
		"template/sheet/item/navigator-power.hbs",
		"utf8",
	);

	/** Every template render asserts on this — a raw key letter never leaks. */
	function renderWith(mastery: string, editable = false): string {
		const { localize, unresolved } = makeLocalize();
		const render = buildHandlebars(localize).compile(source);
		const html = render({
			editable,
			document: { system: { mastery } },
		}) as string;
		expect(unresolved.size, `unresolved: ${[...unresolved].join(", ")}`).toBe(
			0,
		);
		return html;
	}

	it("renders the translated mastery word, not the raw key, when read-only", () => {
		const html = renderWith("novice");
		expect(html).toContain(en["NAVIGATOR_POWER.NOVICE"]!);
		// The old bug's literal output must be gone.
		expect(html).not.toContain("NAVIGATOR_POWER.");
	});

	it("never builds a lowercase mastery key from the schema value", () => {
		// The template must not compose the key itself any more — that is what
		// produced `NAVIGATOR_POWER.novice`.
		expect(source).not.toContain(
			'concat "NAVIGATOR_POWER." document.system.mastery',
		);
	});

	it("the sheet resolves it for every mastery level", () => {
		for (const mastery of ["novice", "adept", "master"]) {
			const html = renderWith(mastery);
			expect(html).toContain(en[`NAVIGATOR_POWER.${mastery.toUpperCase()}`]!);
		}
	});
});

describe("every sheet registry label has a translation", () => {
	it("no registered type label is missing from lang/en.json", () => {
		// Mirrors bootstrap/sheets.ts: a registry entry without an explicit
		// `label` falls back to `TYPES.<Document>.<type>`, and every entry
		// that DOES set one must resolve too.
		const registry = readFileSync(
			"src/roguetrader/bootstrap/sheet-registry.ts",
			"utf8",
		);
		const raw = [...registry.matchAll(/label:\s*"([A-Z][A-Z0-9_.]*)"/g)];
		// Corpus guard: the scan must actually be seeing the registry, not an
		// empty set that trivially passes.
		expect(raw.length).toBeGreaterThan(20);
		const labels = raw
			.map((m) => m[1]!)
			// Deduplicate: the generic Gear subtypes deliberately share one label.
			.filter((key, i, all) => all.indexOf(key) === i);
		const missing = labels.filter((key) => en[key] === undefined).sort();
		expect(
			missing,
			`sheet-registry labels with no lang/en.json entry: ${missing.join(", ")}`,
		).toEqual([]);
	});
});
