// Template-scan guards for the tabbed dynasty sheet (bead twtq):
// - the sheet declares the system's tabbed anatomy (TABS group "primary",
//   the shared tabs nav part, one part per tab);
// - the six choice tabs all render ONE shared template (never hand-copied);
// - every tab section carries data-group/data-tab wiring;
// - the Warrant pickers, the starting roll and the clear action sit INSIDE
//   an {{#if editable}} branch — players get the read-only chips instead
//   (bead twtq permissions decision).
// Static assertions follow the background-afflictions.test.ts precedent.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WARRANT_ROWS } from "../../rules/warrant";
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

const { DynastySheet } = await import("./dynasty-sheet");
// The shared nav template is asserted EQUAL to the character sheet's (the
// canonical tabbed sheet) — template paths are PARTS-derived here rather
// than literal strings so this test file is never mistaken for a sheet by
// the verify:templates owner greps (bead twtq).
const { CharacterSheet } = await import("./character-sheet");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const TAB_IDS = ["record", ...WARRANT_ROWS];
const parts = Object.entries(
	DynastySheet.PARTS as never as Record<string, { template: string }>,
);
const TABS_NAV_TEMPLATE = parts.find(([id]) => id === "tabs")![1].template;
const CHOICE_TEMPLATE = parts.find(([id]) => id === WARRANT_ROWS[0])![1].template;

describe("DynastySheet tab anatomy (bead twtq)", () => {
	test("it declares the shared tabs nav part", () => {
		expect(Object.keys(DynastySheet.PARTS)).toContain("tabs");
		expect(TABS_NAV_TEMPLATE).toBe(
			(CharacterSheet.PARTS as never as Record<string, { template: string }>)
				.tabs?.template,
		);
	});

	test("there is a record tab and one part per warranted chart row", () => {
		for (const id of TAB_IDS) {
			expect(Object.keys(DynastySheet.PARTS)).toContain(id);
		}
	});

	test("the six choice tabs render ONE shared template", () => {
		const choiceParts = parts.filter(([id]) =>
			WARRANT_ROWS.includes(partIdRow(id)),
		);
		expect(choiceParts.length).toBe(WARRANT_ROWS.length);
		for (const [, part] of choiceParts) {
			expect(part.template).toBe(CHOICE_TEMPLATE);
		}
	});

	test("TABS group primary starts on record and lists record + all six rows", () => {
		const group = (DynastySheet.TABS as never as {
			primary: {
				tabs: Array<{ id: string; group: string; label: string }>;
				initial: string;
			};
		}).primary;
		expect(group.tabs.map((tab) => tab.id)).toEqual(TAB_IDS);
		expect(group.tabs.every((tab) => tab.group === "primary")).toBe(true);
		expect(group.initial).toBe("record");
		// Tab labels: chart rows reuse the WARRANT.ROW_* step labels.
		const record = group.tabs.find((tab) => tab.id === "record")!;
		expect(record.label).toBe("DYNASTY.TAB_RECORD");
	});

	test("every tab section in the record template carries data-group + data-tab wiring", () => {
		const source = readFileSync(
			"template/sheet/actor/tabs/dynasty-record.hbs",
			"utf8",
		);
		expect(source).toContain(
			'<section class="tab {{tabs.record.cssClass}}" data-group="primary" data-tab="record">',
		);
	});

	test("every tab section in the shared choice template carries data-tab wiring", () => {
		const source = readFileSync(
			"template/sheet/actor/tabs/dynasty-choice.hbs",
			"utf8",
		);
		expect(source).toContain("data-group=\"primary\"");
		expect(source).toContain("data-tab=\"{{rowId}}\"");
		// One shared template: it must NOT hardwire a specific row id or name.
		for (const row of WARRANT_ROWS) {
			expect(source).not.toContain(`data-tab="${row}"`);
		}
	});

	test("the choice template shows the picked entry (name, enriched prose, SP/PF chips, notes)", () => {
		const source = readFileSync(
			"template/sheet/actor/tabs/dynasty-choice.hbs",
			"utf8",
		);
		const resolved = slice(source, "{{#if warrantTab.resolved}}", "{{else}}");
		expect(resolved).toContain("{{{warrantTab.descriptionHTML}}}");
		expect(resolved).toContain("{{warrantTab.name}}");
		expect(resolved).toContain("warrantTab.shipPoints");
		expect(resolved).toContain("warrantTab.profitFactor");
		expect(resolved).toContain("warrantTab.notes");
	});

	test("an unpicked row shows the hint, never a blank tab", () => {
		const source = readFileSync(
			"template/sheet/actor/tabs/dynasty-choice.hbs",
			"utf8",
		);
		const unpicked = slice(source, "{{else}}", "{{/if}}");
		expect(unpicked).toContain("DYNASTY.WARRANT_CHOICE_NONE");
	});
});

describe("DynastySheet permissions (bead twtq owner decision)", () => {
	const source = readFileSync(
		"template/sheet/actor/tabs/dynasty-record.hbs",
		"utf8",
	);

	/** Is `anchor` (e.g. a picker input) inside an `{{#if editable}}` branch? */
	function insideEditableBranch(anchor: string): boolean {
		const at = source.indexOf(anchor);
		expect(at).toBeGreaterThan(-1);
		const branchOpen = source.lastIndexOf("{{#if editable}}", at);
		if (branchOpen === -1) return false;
		const branchClose = source.indexOf("{{/if}}", branchOpen);
		return branchClose > at;
	}

	test("the warrant pickers sit inside the editable branch", () => {
		// The full attribute (the header comment mentions the selector only).
		expect(insideEditableBranch('data-warrant-row="{{wr.row}}"')).toBe(true);
		// ...in the warrant section specifically (the hint precedes the grid).
		const grid = source.slice(
			source.indexOf("warrant-grid"),
			source.indexOf("{{else}}", source.indexOf("warrant-grid")),
		);
		expect(grid).toContain("data-warrant-row");
	});

	test("the roll and clear actions sit inside editable branches too", () => {
		expect(insideEditableBranch('data-action="rollStarting"')).toBe(true);
		expect(insideEditableBranch('data-action="clearWarrant"')).toBe(true);
	});

	test("players still get the read-only picked-chips line outside the editors", () => {
		const chips = source.slice(source.indexOf("{{#each warrantChoices as |c|}}"));
		expect(chips).toContain("warrant-row-label");
		expect(chips).toContain("chip");
		// The chips line must NOT be inside an editable branch.
		const chipAt = source.indexOf("{{#each warrantChoices as |c|}}");
		const branchOpen = source.lastIndexOf("{{#if editable}}", chipAt);
		const branchClose = branchOpen === -1 ? -1 : source.indexOf("{{/if}}", branchOpen);
		expect(branchClose < chipAt || branchOpen === -1).toBe(true);
	});
});

/** Map a choice part id back to its chart row (part ids ARE row ids). */
function partIdRow(partId: string): (typeof WARRANT_ROWS)[number] {
	return partId as (typeof WARRANT_ROWS)[number];
}

/** Slice `source` between the first-occurrence anchors (inclusive start). */
function slice(source: string, start: string, end: string): string {
	const at = source.indexOf(start);
	const to = source.indexOf(end, at + start.length);
	return source.slice(at, to > at ? to : undefined);
}