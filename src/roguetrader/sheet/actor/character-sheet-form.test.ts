// Regression test for the character-sheet "value edits don't take hold" bug
// (fixed 2026-09-22): two inputs sharing one `name` in the same ApplicationV2
// form make Foundry's FormDataExtended#getFieldValue submit an ARRAY of values
// (its RadioNodeList handling returns one entry per element), and an array
// fails the data model's NumberField validation ("must be a number"). Because
// the sheet submits on every change, the WHOLE update was refused — no edit,
// not even on unrelated fields, persisted.
//
// The bug was concrete: system.insanity and system.corruption had editable
// inputs in BOTH parts/header.hbs (tracker strip) and tabs/background.hbs
// (madness row), whose RadioNodeList value arrived as [0, 0].
//
// This test pins the invariant statically: collect every static name=
// attribute across the templates CharacterSheet co-renders (its PARTS
// templates plus any shared partials they include) and fail when a bound
// name occurs more than once in the form. The stub-module import follows the
// creators.test.ts pattern (sheet modules touch the foundry global at load).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG", "Handlebars"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = { i18n: { localize: (key: string) => key } };
globals.Handlebars = { registerPartial: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		sheets: { ActorSheetV2: class {} },
	},
	abstract: { TypeDataModel: class {} },
	documents: { Item: class {}, Actor: class {} },
};

const { CharacterSheet } = await import("./character-sheet");
const { SHARED_PARTIALS } = await import("../partials");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const TEMPLATE_ROOT = "template/";

/** rt/ partial name (e.g. "paired-value") -> its template file path. */
function partialFile(partial: string): string | undefined {
	return SHARED_PARTIALS.find((p) => p.split("/").pop() === `${partial}.hbs`);
}

/**
 * Template paths are read from disk with {{> "rt/<partial>"}} includes
 * resolved (once, cycles guarded), so an included partial's inputs count as
 * part of the same form.
 */
function loadWithIncludes(path: string): string {
	const seen = new Set<string>();
	const load = (rel: string): string => {
		if (seen.has(rel)) return "";
		seen.add(rel);
		const source = readFileSync(`${TEMPLATE_ROOT}${rel}`, "utf8");
		return source.replace(
			/\{\{>\s*"rt\/([\w-]+)"/g,
			(_match, partial: string) => {
				const file = partialFile(partial);
				return file ? load(file) : `MISSING_PARTIAL_${partial}`;
			},
		);
	};
	return load(path.replace("systems/rogue-trader/template/", ""));
}

/** name="..." attributes on actual form controls (<input>/<select>/<textarea>) in the source. */
function boundNames(source: string): string[] {
	// prose-mirror elements carry a name but are editors, not form controls,
	// and data-name= must not match — only elements that contribute submit data.
	return [
		...source.matchAll(
			/<(?:input|select|textarea)\b[^>]*?\bname="([^"]+)"/g,
		),
	].map((match) => match[1]);
}

describe("CharacterSheet form input names (single-bound invariant)", () => {
	const templates = Object.values(
		CharacterSheet.PARTS as never as Record<string, { template: string }>,
	).map((part) => part.template);

	test("the sheet co-renders several parts (test stays meaningful)", () => {
		expect(templates.length).toBeGreaterThan(1);
	});

	test("every rt/ partial reference resolves to a registered shared partial", () => {
		for (const template of templates) {
			expect(loadWithIncludes(template)).not.toMatch(/MISSING_PARTIAL_/);
		}
	});

	test("no static bound name appears twice across the co-rendered form", () => {
		const nameCounts = new Map<string, number>();
		for (const template of templates) {
			for (const name of boundNames(loadWithIncludes(template))) {
				if (name.includes("{{")) continue; // handled by the test below
				nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
			}
		}
		const duplicates = [...nameCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} x${count}`);
		expect(duplicates).toEqual([]);
	});

	test("dynamic names stay limited to the known intentional ones", () => {
		// Dynamic names cannot be validated statically: `{{nameValue}}`/
		// `{{nameMax}}` are render-time parameters of the paired-value partial
		// (expanded to system.wounds.value etc.), and the characteristics input
		// is unique per key. Pin the SET so a new dynamic binding is a conscious
		// decision, not an accident that reintroduces the array-submit bug in
		// disguise.
		const dynamic = new Set(
			templates
				.flatMap((template) => boundNames(loadWithIncludes(template)))
				.filter((name) => name.includes("{{")),
		);
		expect([...dynamic].sort()).toEqual([
			"system.characteristics.{{c.key}}.value",
			"{{nameMax}}",
			"{{nameValue}}",
		]);
	});
});