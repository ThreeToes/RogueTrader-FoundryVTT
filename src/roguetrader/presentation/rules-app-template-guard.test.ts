/**
 * Template-scan guards for the rules app (epic wxut, child B4).
 *
 * The app's knob form is GENERATED from the knob registry
 * (src/ffg/domain/rule-knobs.ts) through the pure view model
 * (presentation/rules-view-model.ts): there is no per-knob markup in the
 * template and no core value written out by hand. That is a property a refactor
 * can silently destroy, so it is pinned here the same way bead 8aba pins the
 * advancement dialog's affordances.
 *
 * What these guards watch for:
 *   1. every control kind the view model emits has a branch in the template
 *      (number input, checkbox, select, the hit-location table editor);
 *   2. the table editor renders the VIEW MODEL's rows — a context-depth walk
 *      at that nesting level is the trap bead 8aba hit on the advancement
 *      dialog, so the rows must carry their own data;
 *   3. no knob value is hardcoded in the template (a core value is profile
 *      data, never a literal);
 *   4. the i18n keys the template localises exist in lang/en.json.
 *   5. the NEW panel (import/export, bead wxut.5) RENDERS: `bun run
 *      verify:templates` compiles every template against an EMPTY context, so
 *      a body that only runs with data — packExportCount, packScope,
 *      notice.heading — can carry a broken expression unnoticed (bead 7tjo).
 *      The two tests at the bottom extract those bodies and compile them
 *      against the shape _prepareContext actually builds.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
	RULE_KNOBS,
	type KnobControl,
} from "../../ffg/domain/rule-knobs";
import { knobFields } from "./rules-view-model";

const TEMPLATE = "template/dialog/rules-app.hbs";
const template = readFileSync(TEMPLATE, "utf8");
/** The app's own source: the tab ids/labels the template composes at runtime. */
const appSource = readFileSync(
	"src/roguetrader/presentation/rules-app.ts",
	"utf8",
);

/** Handlebars comments stripped, so token scans only see real block tokens. */
const code = template
	.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
	.replace(/\{\{!.*?\}\}/g, "");

/** Every control kind the registry uses, taken from the registry itself. */
const REGISTRY_CONTROLS = [...new Set(RULE_KNOBS.map((k) => k.control))].sort();

describe("rules app template (bead wxut.4)", () => {
	test("the template exists at the shipped path", () => {
		expect(TEMPLATE).toBe("template/dialog/rules-app.hbs");
	});

	test("every control kind in the registry has a rendering branch", () => {
		// A new knob with a control the template cannot render must fail here,
		// not in front of a GM.
		const byKind: Record<KnobControl, RegExp> = {
			// A number input, identified by its bound data-knob attribute.
			number: /<input type="number" data-knob="/,
			// A checkbox: the boolean control.
			boolean: /<input type="checkbox" data-knob="/,
			// A select, whose options come from the field view model.
			select: /<select data-knob="[\s\S]*?{{#each f\.options/,
			// The whole-replacement band table.
			table: /<table class="rule-band-table">/,
		};
		for (const control of REGISTRY_CONTROLS) {
			expect(
				byKind[control].test(code),
				`no rendering branch for a "${control}" control`,
			).toBe(true);
		}
	});

	test("the knob form is generated: one row per registry knob, zero literals", () => {
		// The rows come from the view model's groups; nothing is written out.
		expect(code).toContain("{{#each groups as |g|}}");
		expect(code).toContain("{{#each g.fields as |f|}}");
		// No knob key or knob label appears as a literal in the template.
		for (const knob of RULE_KNOBS) {
			expect(code).not.toContain(knob.key);
			expect(code).not.toContain(knob.labelKey);
		}
		// No core value is written out either: the "Core" reference column is
		// the view model's display, not a number a refactor could let drift.
		for (const field of knobFields({}, true)) {
			if (typeof field.value === "number") {
				expect(code).not.toContain(`value="${field.value}"`);
			}
		}
	});

	test("the core reference is displayed per knob, with its hazard hint", () => {
		expect(code).toContain("{{localize f.hazardKey}}");
		expect(code).toContain("{{localize f.hintKey}}");
		expect(code).toContain('data-tooltip="{{localize f.hintKey}}"');
		expect(code).toContain("{{#if f.overridden}}");
		expect(code).toContain('{{localize "RULES.OVERRIDDEN"}}');
	});

	test("the hit-location table renders the view model's rows (no depth walk)", () => {
		// The band rows carry their own index/knobKey/editable: a `../` walk
		// inside the row loop is the trap bead 8aba pinned on the advancement
		// dialog, so this template must not have one.
		expect(code).toContain("{{#each f.bandRows as |r|}}");
		expect(code).toContain('data-band="band"');
		expect(code).toContain('data-band="location"');
		expect(code).toContain("data-index=\"{{r.index}}\"");
		expect(code).toContain('data-action="removeBand"');
		expect(code).toContain('data-action="addBand"');
		// Every lookup inside the row loop is frame-direct.
		const rowLoop = code.slice(
			code.indexOf("{{#each f.bandRows as |r|}}"),
			code.indexOf("{{/each}}", code.indexOf("{{#each f.bandRows as |r|}}")),
		);
		expect(rowLoop).not.toContain("../");
	});

	test("the four tabs are switchable through data-action (never data-tab)", () => {
		// Foundry 14 core CSS hides `.tab[data-tab]:not(.active)`; a section
		// with a data-tab but no static TABS config renders blank (bead kwd).
		expect(code).not.toContain("data-tab=");
		expect(code).toContain('data-action="tab"');
		expect(code).toContain("data-tab-id=\"{{t.id}}\"");
		expect(code).toContain("{{localize t.labelKey}}");
		// The four panels, each behind an eq on the tab id.
		for (const tab of ["knobs", "json", "diff", "pack"]) {
			expect(code).toContain(`(eq tab "${tab}")`);
		}
		// ...and the ids/label keys the strip is built from live in the app.
		expect(appSource).toContain(
			'const TABS = ["knobs", "json", "diff", "pack"]',
		);
		expect(appSource).toContain("RULES.TAB_");
	});

	test("the JSON tab shows and saves the profile's own delta", () => {
		expect(code).toContain("data-json");
		expect(code).toContain("{{jsonText}}");
		expect(code).toContain('data-action="saveJson"');
		expect(code).toContain("{{#each notice.errors as |e|}}");
	});

	test("the diff panel marks ledger-assuming rows BREAKING", () => {
		expect(code).toContain('{{localize "RULES.DIFF_BREAKING_FLAG"}}');
		expect(code).toContain("{{#if d.breaking}}");
		expect(code).toContain("{{#if d.unknown}}");
		expect(code).toContain("{{#if d.hazardKey}}{{localize d.hazardKey}}{{/if}}");
	});

	test("the import/export panel carries both directions and the notice strip", () => {
		// Export: the scope select and the two sharing tiers (clipboard T0,
		// file T1), on the view model's text.
		expect(code).toContain("data-pack-scope");
		expect(code).toContain("{{packTextOut}}");
		expect(code).toContain('data-action="exportPack"');
		expect(code).toContain('data-action="downloadPack"');
		// Import: the textarea, the file picker, the optional activation and the
		// single import action.
		expect(code).toContain("data-pack-text");
		expect(code).toContain("data-pack-file");
		expect(code).toContain("data-pack-activate");
		expect(code).toContain('data-action="importPack"');
		// An export with nothing to say is TOLD, not an empty textarea.
		expect(code).toContain("{{#if packExportCount}}");
		expect(code).toContain('{{localize "RULES.PACK_EXPORT_EMPTY"}}');
		// The notice strip can head and summarise a pack action (an import
		// report is not "Saved."), and still lists every refusal.
		expect(code).toContain("{{#if notice.heading}}");
		expect(code).toContain("{{notice.message}}");
		expect(code).toContain("{{#each notice.errors as |e|}}");
		// Every pack action the markup dispatches is DECLARED in the app: an
		// action Foundry cannot find is a silent no-op on a live button.
		for (const action of ["exportPack", "downloadPack", "importPack"]) {
			expect(appSource).toContain(`${action}: RulesApp.#on`);
		}
		// ...and the panel's imperative controls are wired in the shell.
		for (const selector of [
			"data-pack-scope",
			"data-pack-activate",
			"data-pack-text",
			"data-pack-file",
		]) {
			expect(appSource).toContain(selector);
		}
	});

	test("the pack panel RENDERS with real data (an empty context cannot)", async () => {
		// `bun run verify:templates` compiles and renders every template with a
		// PERMISSIVE EMPTY context, so a body that only executes with data can
		// carry a broken expression unnoticed — the trap bead 7tjo pinned on the
		// advancement dialog. The pack panel is exactly that: packExportCount,
		// packScope, packTextOut and notice.* are all absent from an empty
		// render. So the panel is compiled HERE against the shape _prepareContext
		// hands it, and the two export states are both exercised.
		const marker = '{{else if (eq tab "pack")}}';
		const start = code.indexOf(marker);
		const end = code.indexOf('{{else if (eq tab "diff")}}', start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const panel = code.slice(start + marker.length, end);
		const Handlebars = (await import("handlebars")).default;
		Handlebars.registerHelper("localize", (key: string) => String(key));
		Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
		const compiled = Handlebars.compile(`{{#if true}}${panel}{{/if}}`);

		// A world with one profile in force: the pack text and both tiers.
		const html = compiled({
			packScope: "active",
			packExportCount: 1,
			packTextOut: '{\n  "kind": "rogue-trader.rule-profiles"',
			packTextIn: "",
			packActivate: false,
			notice: null,
		});
		expect(html).toContain('data-pack-out');
		expect(html).toContain("rogue-trader.rule-profiles");
		expect(html).toContain('data-action="exportPack"');
		expect(html).toContain('data-action="downloadPack"');
		expect(html).toContain('data-action="importPack"');
		// The active scope's option is the selected one.
		expect(html).toContain('<option value="active" selected>');

		// Core rules in force: no pack to export, and the panel SAYS so rather
		// than offering an empty textarea or live export buttons.
		const empty = compiled({
			packScope: "all",
			packExportCount: 0,
			packTextOut: "",
			packTextIn: "pasted",
			packActivate: true,
			notice: null,
		});
		expect(empty).not.toContain('data-pack-out');
		expect(empty).not.toContain('data-action="exportPack"');
		expect(empty).toContain('data-action="importPack"');
		expect(empty).toContain("RULES.PACK_EXPORT_EMPTY");
		// The pasted text and the ticked box survive a re-render.
		expect(empty).toContain('data-pack-activate checked');
		expect(empty).toContain(">pasted<");
	});

	test("the notice strip renders a pack report and every refusal line", async () => {
		// The strip sits ABOVE the panels, so it is extracted on its own for the
		// same reason: the empty-context render never reaches its body.
		const start = code.indexOf("{{#if notice.kind}}");
		const end = code.indexOf('{{#if (eq tab "knobs")}}', start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const Handlebars = (await import("handlebars")).default;
		Handlebars.registerHelper("localize", (key: string) => String(key));
		Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
		const compiled = Handlebars.compile(
			`{{#if true}}${code.slice(start, end)}{{/if}}`,
		);
		// An import report: its own heading, its summary sentence, no error list.
		const ok = compiled({
			notice: {
				kind: "ok",
				errors: [],
				heading: "Imported.",
				message: "1 new profile(s), 0 replaced: Lethal.",
			},
		});
		expect(ok).toContain("<strong>Imported.</strong>");
		expect(ok).toContain("1 new profile(s), 0 replaced: Lethal.");
		expect(ok).not.toContain("<li>");
		// A refusal: the generic heading plus one line per problem, each of which
		// names the offending kind or knob.
		const refused = compiled({
			notice: {
				kind: "error",
				errors: ['this is not a Rogue Trader rules pack: kind is "x"'],
			},
		});
		expect(refused).toContain("RULES.NOT_SAVED");
		// Handlebars escapes the quotes, so the &quot; form is what a GM sees.
		expect(refused).toContain(
			'<li>this is not a Rogue Trader rules pack: kind is &quot;x&quot;</li>',
		);
		// Nothing rendered when there is no notice at all.
		expect(compiled({ notice: null }).trim()).toBe("");
	});

	test("every i18n key the template localises exists in lang/en.json", () => {
		const en = JSON.parse(readFileSync("lang/en.json", "utf8")) as Record<
			string,
			string
		>;
		const keys = [...template.matchAll(/localize "([A-Z][A-Z0-9_.]+)"/g)].map(
			(m) => m[1]!,
		);
		expect(keys.length).toBeGreaterThan(10);
		const missing = keys.filter((key) => en[key] === undefined);
		expect(missing, `lang/en.json is missing: ${missing.join(", ")}`).toEqual(
			[],
		);
	});
});
