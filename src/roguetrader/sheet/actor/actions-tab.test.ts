/**
 * ACTIONS tab guards (epic moew, bead 9r82). Three families:
 * 1. TAB ANATOMY — CharacterSheet declares the actions part + nav tab with
 *    the scrollable: [""] descriptor (character-sheet-scrollable.test.ts's
 *    convention; that test's list was extended, this pins the descriptor +
 *    the template path + the click action registration).
 * 2. THE TAB TEMPLATE — compiled against a 31-row context (the pack's pinned
 *    row count, see the actions pack guard test): every row renders a chip,
 *    chips carry the lookup-card data attributes, unmet rows carry the .unmet
 *    grey class, and the list is the two-column grid.
 * 3. THE CHIP VIEW MODEL — grey wiring + tooltip composition through
 *    actionChipRows (the localiser is injected, so no Foundry here).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { actionCostGlyphs, setActionCatalog } from "../../rules/actions";
import { actionChipRows, type ActionChipRow } from "./actions-view";

beforeAll(() => {
	// The template's Foundry-built helper, stubbed like verify-templates does.
	Handlebars.registerHelper("localize", (key: string) => String(key));
});

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "Hooks", "CONFIG", "Handlebars"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = { i18n: { localize: (key: string) => key } };
globals.Handlebars = { registerPartial: () => undefined };
// The FULL shared foundry stub FIRST (installs once via ??= — it carries
// data.fields that OTHER test files (the packs' schema guard) need), then
// per-key extension with the application bits the sheet class reads at load.
// A wholesale `globals.foundry = {...}` (the scrollable test's pattern)
// clobbers the stub's data.fields for other files whose tests have not yet
// run and cross-fails the suite — do NOT overwrite the whole global here.
await import("../../../test-helpers/foundry-schema-stub");
const foundryRef = globals.foundry as unknown as Record<string, unknown>;
for (const key of ["applications", "documents"] as const) {
	originalGlobals[`foundry.${key}`] = foundryRef[key];
}
foundryRef.applications ??= {
	api: {
		HandlebarsApplicationMixin: (base: unknown) => base,
		ApplicationV2: class {},
	},
	sheets: { ActorSheetV2: class {} },
};
foundryRef.documents ??= { Item: class {}, Actor: class {} };

const { CharacterSheet } = await import("./character-sheet");
const { combatActionChipAction } = await import("./actions-view");

afterEach(() => {
	setActionCatalog([]);
});

afterAll(() => {
	// Restore ONLY the keys this file touched, including the per-key foundry
	// extensions (the shared stub's data/abstract stay installed).
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (key.startsWith("foundry.")) {
			const record = globals.foundry as unknown as Record<string, unknown>;
			const slot = key.slice("foundry.".length);
			if (value === undefined) delete record[slot];
			else record[slot] = value;
		} else if (value === undefined) {
			delete globals[key];
		} else {
			globals[key] = value;
		}
	}
});

describe("CharacterSheet actions-tab anatomy", () => {
	const parts = CharacterSheet.PARTS as unknown as Record<
		string,
		{ template?: string; scrollable?: string[] }
	>;

	test("the actions part is a scrolling tab part on the real template", () => {
		const part = parts.actions;
		expect(part, "PARTS.actions missing").toBeDefined();
		expect(part.template).toBe(
			"systems/rogue-trader/template/sheet/actor/tabs/actions.hbs",
		);
		expect(part.scrollable, "actions tab must preserve scroll").toEqual([""]);
	});

	test("the nav carries the actions tab with the TAB.ACTIONS label", () => {
		const tabs = (CharacterSheet.TABS as unknown as {
			primary: { tabs: Array<{ id: string; label: string }> };
		}).primary.tabs;
		const tab = tabs.find((t) => t.id === "actions");
		expect(tab, "no actions tab in TABS.primary").toBeDefined();
		expect(tab?.label).toBe("TAB.ACTIONS");
	});

	test("the chip click action is registered as combatAction", () => {
		const actions = (CharacterSheet.DEFAULT_OPTIONS as unknown as {
			actions: Record<string, unknown>;
		}).actions;
		expect(actions.combatAction).toBe(combatActionChipAction);
	});
});

describe("the actions tab template (31-row render)", () => {
	const compiled = Handlebars.compile(
		readFileSync("template/sheet/actor/tabs/actions.hbs", "utf8"),
	);

	/** 31 chips: a third unmet, a third roll-spec, all names distinct. */
	const rows: ActionChipRow[] = Array.from({ length: 31 }, (_, index) => ({
		name: `Action ${index + 1}`,
		uuid: `Compendium.rogue-trader.actions.Item.${index}`,
		costGlyph: actionCostGlyphs("Half"),
		hasRoll: index % 3 === 0,
		available: index % 3 !== 1,
		tooltip: `Tooltip ${index + 1}`,
	}));

	test("all 31 actions render as two-column chips", () => {
		const html = compiled({ tabs: { actions: { cssClass: "" } }, actions: rows });
		const container = html.match(/class="action-list/) ?? [];
		expect(container.length, "the two-column chip grid is missing").toBe(1);
		// Two-column = the CSS grid on .action-list (the design-language token);
		// the template pairs with its CSS.
		const css = readFileSync("css/sheet-character.css", "utf8");
		expect(css).toContain(
			".action-list {\n\tdisplay: grid;\n\tgrid-template-columns: repeat(2, 1fr);",
		);
		expect(html.match(/class="action-row/g)?.length).toBe(31);
		expect(html.match(/class="action-chip"/g)?.length).toBe(31);
		// The cost cell renders the glyph (◑ Half), not the printed word.
		expect(html).toContain('class="action-cost">◑</span>');
		// And the fixed-width right-aligned cell (consistent sizing).
		expect(css).toContain(".action-chip .action-cost {\n\tflex: none;\n\tmin-width: 3.4em;");
	});

	test("unmet chips carry the .unmet grey class (visible, never hidden)", () => {
		const html = compiled({ tabs: { actions: { cssClass: "" } }, actions: rows });
		expect(html.match(/action-row unmet/g)?.length).toBe(
			10, // indexes ≡ 1 (mod 3) across 31 rows
		);
	});

	test("chips carry the lookup-card data attributes (name + roll flag + uuid)", () => {
		const html = compiled({ tabs: { actions: { cssClass: "" } }, actions: rows });
		expect(html).toContain('data-action="combatAction"');
		expect(html).toContain('data-has-roll="true"');
		expect(html).toContain('data-uuid="Compendium.rogue-trader.actions.Item.0"');
	});

	test("the tab root carries the scroll-container anatomy", () => {
		const html = compiled({ tabs: { actions: { cssClass: "active" } }, actions: [] });
		expect(html).toContain('<section class="tab');
		expect(html).toContain('data-tab="actions"');
		expect(html).toContain('data-group="primary"');
	});
});

describe("actionChipRows (grey wiring + tooltips)", () => {
	const localize = (key: string) => `[i18n:${key}]`;

	test("unmet chips grey + lead the tooltip with the unmet hint", () => {
		const rows = actionChipRows(
			[
				{
					key: "brace-heavy-weapon",
					name: "Brace Heavy Weapon",
					uuid: "u",
					actionCost: "Half",
					actionNote: "",
					subtypes: "",
					prerequisites: "A Heavy weapon.",
					shortDescription: "Prepare to fire a heavy weapon.",
					rollTest: "",
					rollDifficulty: "",
					difficulty: { kind: "none", value: 0 },
					prereqKind: "heavy-weapon",
				},
			],
			// No heavy weapon carried.
			{
				heavyWeapon: false,
				rangedFullAuto: false,
				rangedSemiAuto: false,
				readyWeapons: 0,
				talents: new Set(),
			},
			localize,
		);
		expect(rows[0].available).toBeFalse();
		expect(rows[0].tooltip).toContain("[i18n:ACTION.PREREQ_UNMET]");
		expect(rows[0].tooltip).toContain("A Heavy weapon.");
	});

	test("available chips tooltip the printed terse line; Varies adds its note", () => {
		const rows = actionChipRows(
			[
				{
					key: "aim",
					name: "Aim",
					uuid: "u",
					actionCost: "Half/Full",
					actionNote: "",
					subtypes: "",
					prerequisites: "",
					shortDescription: "+10 bonus to hit as a Half Action…",
					rollTest: "",
					rollDifficulty: "",
					difficulty: { kind: "none", value: 0 },
					prereqKind: "none",
				},
				{
					key: "reload",
					name: "Reload",
					uuid: "u",
					actionCost: "Varies",
					actionNote: "Varies by weapon",
					subtypes: "",
					prerequisites: "",
					shortDescription: "Reload.",
					rollTest: "",
					rollDifficulty: "",
					difficulty: { kind: "none", value: 0 },
					prereqKind: "none",
				},
			],
			{
				heavyWeapon: false,
				rangedFullAuto: false,
				rangedSemiAuto: false,
				readyWeapons: 0,
				talents: new Set(),
			},
			localize,
		);
		expect(rows[0].available).toBeTrue();
		// The cost word leads the tooltip (the glyphs' accessible form).
		expect(rows[0].tooltip).toBe(
			"Half/Full — +10 bonus to hit as a Half Action…",
		);
		// The Varies COST keeps its printed word in the cell (no invented
		// glyph) and the note rides the tooltip.
		expect(rows[1].costGlyph).toBe("Varies");
		expect(rows[1].tooltip).toContain("Varies (Varies by weapon)");
	});

	test("roll-spec chips carry the roll wiring note in their tooltip (bead et5a)", () => {
		const rows = actionChipRows(
			[
				{
					key: "dodge",
					name: "Dodge",
					uuid: "u",
					actionCost: "Reaction",
					actionNote: "",
					subtypes: "",
					prerequisites: "",
					shortDescription: "Dodge an attack.",
					rollTest: "dodge",
					rollDifficulty: "",
					difficulty: { kind: "none", value: 0 },
					prereqKind: "none",
				},
				{
					key: "called-shot",
					name: "Called Shot",
					uuid: "u2",
					actionCost: "Full",
					actionNote: "",
					subtypes: "",
					prerequisites: "",
					shortDescription: "Hit a specific location.",
					rollTest: "strength",
					rollDifficulty: "Hard (–20)",
					difficulty: { kind: "numeric", value: -20 },
					prereqKind: "none",
				},
			],
			{
				heavyWeapon: false,
				rangedFullAuto: false,
				rangedSemiAuto: false,
				readyWeapons: 0,
				talents: new Set(),
			},
			localize,
		);
		expect(rows[0].hasRoll).toBeTrue();
		// No printed difficulty: the generic click-to-roll note.
		expect(rows[0].tooltip).toContain("[i18n:ACTION.ROLL_CLICK]");
		// A printed difficulty is shown verbatim (the book's own data).
		expect(rows[1].tooltip).toContain("[i18n:ACTION.DIFFICULTY]: Hard (–20)");
	});
});
// --- Bead et5a: the action ROLL card --------------------------------------

describe("the action-roll chat card template (template-scan guard)", () => {
	const compiled = Handlebars.compile(
		readFileSync("template/chat/action-roll.hbs", "utf8"),
	);

	test("renders the doc link, cost, result and the manual-opposed note", () => {
		const html = compiled({
			titleDoc: {
				prefix: "",
				name: "Called Shot",
				suffix: "",
				link: { action: "openPackDoc", uuid: "u1", name: "Called Shot" },
			},
			costLabel: "Action Type",
			cost: "Full",
			descriptionLabel: "Action Description",
			description: "Hit a specific location.",
			target: 20,
			roll: 23,
			outcomeLabel: "Success (+3 degrees)",
			outcomeClass: "success",
			opposedNote: "Opposed test: the opposing side rolls their test manually.",
		});
		// The lookup anatomy: name as the pack-doc anchor + cost + description.
		expect(html).toContain('data-uuid="u1"');
		expect(html).toContain(">Called Shot</a>");
		expect(html).toContain("Action Type");
		expect(html).toContain("Hit a specific location.");
		// The roll result fields (the roll card's summary anatomy).
		expect(html).toContain('class="roll-result success"');
		expect(html).toContain("Success (+3 degrees)");
		// The manual-resolution note (opposed rolls stay manual).
		expect(html).toContain(
			"Opposed test: the opposing side rolls their test manually.",
		);
	});

	test("no titleDoc degrades the title to text; no note hides the row", () => {
		const html = compiled({
			title: "Tester — Dodge",
			costLabel: "Action Type",
			cost: "Reaction",
			target: 45,
			roll: 55,
			outcomeLabel: "Failure",
			outcomeClass: "failure",
		});
		expect(html).toContain("Tester — Dodge");
		expect(html).toContain('class="roll-result failure"');
		expect(html).not.toContain("action-note");
	});
});
