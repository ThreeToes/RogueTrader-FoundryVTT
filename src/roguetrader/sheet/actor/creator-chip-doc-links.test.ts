/**
 * Creator-chip pack-doc links (epic 61pk, bead hjve).
 *
 * Three layers guarded here, mirroring advancement-dialog-guard.test.ts:
 * 1. TEMPLATE SCAN — every chip site in character-creator.hbs that links to
 *    its pack doc carries the library's anchor (data-action + data-uuid) AND
 *    keeps the pick flow's own data-action in the same scan. The anchor is a
 *    NON-ANCHOR affordance INSIDE the chip (see the css comment): nested
 *    <a> elements are invalid HTML (the parser breaks the chip apart), so
 *    the doc affordance is a span/i carrying its own data-action — Foundry
 *    dispatches the INNERMOST [data-action] only (foundry.mjs:130371,
 *    event.target.closest), so the chip's pick action is never hijacked.
 * 2. DISPATCH — the creator's openPackDoc action resolves through
 *    resolvePackDocument + openDocumentSheet with FAKE ports + a fake pack
 *    (setPorts, bead qgtz's notify scan convention): opens the sheet on a
 *    valid uuid, loud notify on an unresolvable one, no-op without one.
 * 3. DEGRADATION — unresolvable picks (no uuid from the catalogs, e.g. a
 *    parameterised talent pick like "Resistance (Poisons)") produce NO
 *    anchor payload; the template's {{#if ...link}} guards render the chip
 *    exactly as before (plain text, never an error).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TEMPLATE = "template/sheet/actor/character-creator.hbs";
const template = readFileSync(TEMPLATE, "utf8");

/** Handlebars comments stripped, so token scans only see real block tokens. */
const code = template
	.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
	.replace(/\{\{!.*?\}\}/g, "");

// ------------------------------------------------------------------ 1. template

describe("character creator chip doc links — template scan (bead hjve)", () => {
	/** The region between two markers (loud -1s handled by the callers). */
	function region(startMarker: string, endMarker: string): string {
		const start = code.indexOf(startMarker);
		const end = code.indexOf(endMarker, start + 1);
		expect(start, startMarker).toBeGreaterThan(-1);
		expect(end, endMarker).toBeGreaterThan(start);
		return code.slice(start, end);
	}

	/** Every doc-link affordance a template region carries. */
	function docLinks(source: string): string[] {
		return [
			...source.matchAll(/<span class="adv-doc-link chip-doc-link"[^>]*>/g),
		].map((match) => match[0]);
	}

	test("career chips: chooseCareer preserved, and the doc affordance rides the chip", () => {
		const chips = region(
			'{{localize "CREATOR.CAREER"}}</h2>',
			'{{localize "CREATOR.REVIEW_CHARACTERISTICS"}}',
		);
		// THE NON-HIJACK GATE: the pick flow's own action is untouched.
		expect(chips).toContain('data-action="chooseCareer"');
		expect(chips).toContain("selected");
		// One affordance per chip block, carrying the library's action+uuid.
		const links = docLinks(chips);
		expect(links.length).toBe(1);
		for (const link of links) {
			expect(link).toContain('data-action="{{career.link.action}}"');
			expect(link).toContain('data-uuid="{{career.link.uuid}}"');
		}
	});

	test("origin chips: chooseOrigin preserved, and the doc affordance rides the chip", () => {
		const chips = region(
			'<h2>{{localize row.labelKey}}</h2>',
			'{{#if row.detail}}',
		);
		expect(chips).toContain('data-action="chooseOrigin"');
		// The de-deselect convention (data-key empty when already picked) survives.
		expect(chips).toContain('data-key="{{#if opt.selected}}{{else}}{{opt.key}}{{/if}}"');
		const links = docLinks(chips);
		expect(links.length).toBe(1);
		for (const link of links) {
			expect(link).toContain('data-action="{{opt.link.action}}"');
			expect(link).toContain('data-uuid="{{opt.link.uuid}}"');
		}
	});

	test("talent option-pick chips: choosePickOption preserved, and the doc affordance rides the chip", () => {
		const chips = region(
			'data-kind="variant"',
			'data-kind="charChoice"',
		);
		expect(chips).toContain('data-action="choosePickOption"');
		expect(chips).toContain('data-kind="option"');
		const links = docLinks(chips);
		expect(links.length).toBe(1);
		for (const link of links) {
			expect(link).toContain('data-action="{{option.link.action}}"');
			expect(link).toContain('data-uuid="{{option.link.uuid}}"');
		}
	});

	test("exactly THREE chip sites link (career/origin/talent picks) — no other chip gained an affordance", () => {
		// Species/variant/charChoice/alternate/corruption-insanity/acquisition
		// chips have no single pack doc; a fourth site needs conscious review.
		expect((code.match(/chip-doc-link/g) ?? []).length).toBe(3);
		expect((code.match(/data-action="\{\{career\.link\.action\}\}"/g) ?? []).length).toBe(1);
		expect((code.match(/data-action="\{\{opt\.link\.action\}\}"/g) ?? []).length).toBe(1);
		expect((code.match(/data-action="\{\{option\.link\.action\}\}"/g) ?? []).length).toBe(1);
		// The pick actions the creator wizard depends on all still exist.
		// ("finish" rides the shared creator-nav partial's forwardAction
		// param — it is not a literal data-action here.)
		for (const action of [
			"chooseSpecies",
			"chooseOrigin",
			"choosePickOption",
			"chooseCorrIns",
			"chooseCareer",
			"chooseAcquisition",
			"setMethod",
			"rollOne",
			"alloc",
			"rollHeirloom",
			"toggleAcqGroup",
		]) {
			expect(code, action).toContain(`data-action="${action}"`);
		}
	});

	test("unresolvable picks degrade to plain text — every affordance is behind its link guard", () => {
		// The affordance span only renders when the payload exists; without
		// it the chip markup is byte-identical to the pre-hjve template.
		expect((code.match(/\{\{#if opt\.link\}\}/g) ?? []).length).toBe(1);
		expect((code.match(/\{\{#if career\.link\}\}/g) ?? []).length).toBe(1);
		expect((code.match(/\{\{#if option\.link\}\}/g) ?? []).length).toBe(1);
		// No affordance anywhere without data-uuid (a uuid-less anchor is a
		// dead click, so the guard forbids rendering one).
		for (const link of docLinks(code)) {
			expect(link).toContain("data-uuid=");
		}
	});
});

// ------------------------------------------------------------------ 2. dispatch

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = {
	i18n: { localize: (key: string) => key, format: (key: string) => key },
	system: { id: "rogue-trader" },
};
globals.ui = { notifications: { warn: () => undefined, info: () => undefined } };
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				render(): Promise<unknown> {
					return Promise.resolve();
				}
			},
			DialogV2: { wait: async () => null, input: async () => null },
		},
	},
	sheets: {},
	handlebars: {
		renderTemplate: async () => "",
		getTemplate: async () => () => "",
	},
	documents: { Item: class {}, Actor: class {}, ChatMessage: { get: () => undefined } },
	utils: { mergeObject: () => undefined, fromUuid: async () => undefined },
};
// Fake compendium (foundry.mjs:39440 shape via resolvePackDocument): pack
// lookup returns a getDocument stub — "abc" resolves to a sheet-carrying doc.
let resolvedPacks: Map<string, unknown> | null = null;
(globals.game as Record<string, unknown>).packs = {
	get: (id: string) => resolvedPacks?.get(id),
};

const { CharacterCreator } = await import("./character-creator");

/** Ports stubs (setPorts seam): records every notify payload. */
const notifications: Array<{ level: string; key: string; vars?: unknown }> = [];
const { setPorts, resetPorts } = await import(
	"../../../ffg/infrastructure/foundry/ports"
);

afterAll(() => {
	resetPorts();
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

/** The action handlers the creator exposes to Foundry. */
function actionsOf(
	ctor: unknown,
): Record<string, (this: unknown, event: unknown, target: HTMLElement) => Promise<void>> {
	return (
		ctor as unknown as { DEFAULT_OPTIONS: { actions: Record<string, never> } }
	).DEFAULT_OPTIONS.actions as unknown as Record<
		string,
		(this: unknown, event: unknown, target: HTMLElement) => Promise<void>
	>;
}

describe("character creator openPackDoc dispatch (bead hjve)", () => {
	test("openPackDoc is a registered action and the library action name", async () => {
		const { OPEN_PACK_DOC_ACTION } = await import("../pack-doc-links");
		const actions = actionsOf(CharacterCreator);
		expect(typeof actions.openPackDoc).toBe("function");
		// The convention cannot drift: the action key IS the library constant.
		expect(Object.keys(actions)).toContain(OPEN_PACK_DOC_ACTION);
	});

	test("a resolvable uuid opens the pack doc's sheet read-only (no notify)", async () => {
		let rendered = 0;
		const fakeDoc = {
			sheet: {
				render: async () => {
					rendered++;
				},
			},
		};
		resolvedPacks = new Map([
			[
				"rogue-trader.character-options",
				{
					getDocument: async (id: string) =>
						id === "abc" ? fakeDoc : undefined,
				},
			],
		]);
		setPorts({
			notify: {
				info: (key: string) => notifications.push({ level: "info", key }),
				warn: (key: string) => notifications.push({ level: "warn", key }),
				error: (key: string, vars?: unknown) =>
					notifications.push({ level: "error", key, vars }),
			},
		} as never);
		const handler = actionsOf(CharacterCreator).openPackDoc;
		await handler.call(
			new CharacterCreator() as unknown as object,
			null,
			{ dataset: { uuid: "Compendium.rogue-trader.character-options.Item.abc" } } as unknown as HTMLElement,
		);
		expect(rendered).toBe(1);
		expect(notifications).toEqual([]);
	});

	test("an unresolvable uuid fails LOUDLY through the failure key", async () => {
		resolvedPacks = new Map([
			[
				"rogue-trader.character-options",
				{ getDocument: async () => undefined },
			],
		]);
		setPorts({
			notify: {
				info: (key: string) => notifications.push({ level: "info", key }),
				warn: (key: string) => notifications.push({ level: "warn", key }),
				error: (key: string, vars?: unknown) =>
					notifications.push({ level: "error", key, vars }),
			},
		} as never);
		const handler = actionsOf(CharacterCreator).openPackDoc;
		await handler.call(
			new CharacterCreator() as unknown as object,
			null,
			{ dataset: { uuid: "Compendium.rogue-trader.character-options.Item.nope" } } as unknown as HTMLElement,
		);
		expect(notifications).toEqual([
			{
				level: "error",
				key: "CREATOR.OPEN_DOC_FAIL",
				vars: {
					uuid: "Compendium.rogue-trader.character-options.Item.nope",
				},
			},
		]);
	});

	test("a missing data-uuid is a no-op (never an error)", async () => {
		notifications.length = 0;
		resolvedPacks = new Map();
		const handler = actionsOf(CharacterCreator).openPackDoc;
		await handler.call(
			new CharacterCreator() as unknown as object,
			null,
			{ dataset: {} } as unknown as HTMLElement,
		);
		expect(notifications).toEqual([]);
	});
});

// ------------------------------------------------------------------ 3. degradation

describe("creator chip degradation (bead hjve)", () => {
	test("a pick with no catalog match produces NO anchor payload", async () => {
		// The unresolvable DEGRADATION is the library's own contract (null ->
		// plain text); the creator resolves parameterised talents the same way.
		const { packDocAnchor } = await import("../pack-doc-links");
		expect(
			packDocAnchor(
				{ key: "", name: "Resistance (Poisons)", type: "talent" },
				[],
				[],
			),
		).toBeNull();
	});

	test("the resolvable pick produces the anchor payload the template renders", async () => {
		const { packDocAnchor, OPEN_PACK_DOC_ACTION } = await import(
			"../pack-doc-links"
		);
		expect(
			packDocAnchor(
				{ key: "", name: "Jaded", type: "talent" },
				[],
				[{ key: "jaded", name: "Jaded", uuid: "Compendium.x.Item.1" }],
			),
		).toEqual({
			action: OPEN_PACK_DOC_ACTION,
			uuid: "Compendium.x.Item.1",
			name: "Jaded",
		});
	});
});