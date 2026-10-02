// Regression guard for bead ss1d: the character sheet jumped to the top on
// every re-render (e.g. deleting a mutation) because ApplicationV2 part
// replacement discards scroll position unless the part descriptor lists
// `scrollable` selectors. On CharacterSheet each tab part's root
// <section class="tab"> IS the scroll container (.rogue-trader .tab
// { overflow-y: auto }), and core _syncPartState treats a "" selector as the
// part's own root element — so every tab part must declare scrollable: [""].
//
// Source-scan invariant like character-sheet-form.test.ts: pin ALL tab parts,
// so a refactor adding a new tab cannot silently drop scroll preservation.
// The stub-module import follows the character-sheet-form.test.ts pattern
// (sheet modules touch the foundry global at load).
import { afterAll, describe, expect, test } from "bun:test";

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

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

// Parts that render a scrolling <section class="tab"> root. The header/tabs
// parts carry no scrolling content and are deliberately excluded.
const SCROLLING_TABS = [
	"stats",
	"combat",
	"inventory",
	"background",
	"skills",
	"psychic",
	"notes",
];

describe("CharacterSheet part descriptors (scroll preservation, ss1d)", () => {
	const parts = CharacterSheet.PARTS as unknown as Record<
		string,
		{ template?: string; scrollable?: string[] }
	>;

	test("every tab part has a template and a scrollable: [''] descriptor", () => {
		for (const id of SCROLLING_TABS) {
			const part = parts[id];
			expect(part, `PARTS.${id} missing`).toBeDefined();
			expect(part.template, `PARTS.${id}.template`).toContain("/tabs/");
			expect(
				part.scrollable,
				`PARTS.${id} must declare scrollable: [""] so tab scroll survives re-renders`,
			).toEqual([""]);
		}
	});

	test("the tab list matches the parts (new tabs must opt in)", () => {
		const tabPartIds = Object.keys(parts).filter(
			(id) => parts[id].template?.includes("/tabs/"),
		);
		expect(tabPartIds.sort()).toEqual([...SCROLLING_TABS].sort());
	});

	test("header/tabs parts carry no scrolling content (stay excluded)", () => {
		expect(parts.header?.scrollable).toBeUndefined();
		expect(parts.tabs?.scrollable).toBeUndefined();
	});
});