/**
 * Unit tests for the extracted verifier logic (bead m8eu).
 *
 * The regression these tests pin: verify-templates.mjs's tab-check was
 * silently neutered once (its execSync grep returned nothing, bead 83tl
 * follow-up) — the guard then passed forever and the Foundry 14
 * "data-tab section with no static TABS renders display:none" bug shipped
 * with a green build. The pure checkers in template-verifier.ts are
 * parameterised over template contents and a sheet-owner lookup, so each
 * case can be driven directly, without the repo or execSync.
 */
import { describe, expect, test } from "bun:test";
import Handlebars from "handlebars";
import {
	runRenderChecks,
	tabsCheckSync,
	type SheetOwner,
	type TemplateSource,
} from "./template-verifier";

const compileAndRender = (
	templates: readonly TemplateSource[],
	context: unknown = {},
) =>
	runRenderChecks(
		templates,
		(source) => Handlebars.compile(source),
		(template, ctx) => template(ctx),
		context,
	);

describe("tabsCheckSync", () => {
	const lookupNoOwners = (): readonly SheetOwner[] => [];

	test("data-tab with an owner sheet without static TABS fails", () => {
		const failures = tabsCheckSync(
			[
				{
					rel: "actor/crew.hbs",
					source: '<section class="tab" data-tab="crew">',
				},
			],
			(sysPath) => [
				{
					owner: "src/roguetrader/sheet/actor/crew-sheet.ts",
					source: `class CrewSheet { } // references ${sysPath}`,
				},
			],
		);

		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("tabs");
		expect(failures[0].message).toContain("actor/crew.hbs");
		expect(failures[0].message).toContain("crew-sheet.ts");
		expect(failures[0].message).toContain("no static TABS");
	});

	test("owner with static TABS passes", () => {
		const failures = tabsCheckSync(
			[
				{
					rel: "actor/crew.hbs",
					source: '<section class="tab" data-tab="crew">',
				},
			],
			() => [
				{
					owner: "src/roguetrader/sheet/actor/crew-sheet.ts",
					source: "static TABS = { crew: {} };",
				},
			],
		);
		expect(failures).toHaveLength(0);
	});

	test("owner matched via tabs.*.cssClass binding is skipped entirely", () => {
		let looked = 0;
		const failures = tabsCheckSync(
			[
				{
					rel: "actor/crew.hbs",
					source: '<div data-tab="{{tabs.crew.cssClass}}">…</div>',
				},
			],
			() => {
				looked += 1;
				return [
					{
						owner: "bad.ts",
						source: "no TABS here",
					},
				];
			},
		);
		expect(looked).toBe(0);
		expect(failures).toHaveLength(0);
	});

	test("template referenced by no sheet (partial) is skipped", () => {
		const failures = tabsCheckSync(
			[
				{
					rel: "shared/parts/crew-list.hbs",
					source: '<section class="tab" data-tab="crew">',
				},
			],
			lookupNoOwners,
		);
		expect(failures).toHaveLength(0);
	});

	test("template without data-tab never consults the owner lookup", () => {
		let looked = 0;
		const failures = tabsCheckSync(
			[{ rel: "plain.hbs", source: "<p>{{localize 'x'}}</p>" }],
			() => {
				looked += 1;
				return [{ owner: "bad.ts", source: "no TABS" }];
			},
		);
		expect(looked).toBe(0);
		expect(failures).toHaveLength(0);
	});
});

describe("runRenderChecks", () => {
	test("clean template accumulates zero failures", () => {
		const failures = compileAndRender([
			{ rel: "ok.hbs", source: "<p>fine</p>" },
		]);
		expect(failures).toHaveLength(0);
	});

	test("compile error is reported as a compile failure, render is skipped", () => {
		const failures = runRenderChecks(
			[{ rel: "x.hbs", source: "<p>whatever</p>" }],
			() => {
				throw new Error("boom at compile");
			},
			() => {
				throw new Error("render must not run");
			},
			{},
		);
		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("compile");
		expect(failures[0].message).toContain("boom at compile");
		expect(failures[0].message).not.toContain("render must not run");
	});

	test("render throw is reported as a render failure", () => {
		const failures = runRenderChecks(
			[{ rel: "bad.hbs", source: "<p>x</p>" }],
			(source) => Handlebars.compile(source),
			() => {
				throw new Error("missing helper boom");
			},
			{},
		);
		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("render");
		expect(failures[0].message).toContain("bad.hbs");
		expect(failures[0].message).toContain("missing helper boom");
	});

	test("non-string render output counts as a render failure", () => {
		const failures = runRenderChecks(
			[{ rel: "void.hbs", source: "<p>x</p>" }],
			(source) => Handlebars.compile(source),
			() => undefined,
			{},
		);
		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("render");
		expect(failures[0].message).toContain("render produced no output");
	});

	test("helper-check failures accumulate even when the render passes", () => {
		// The bead-7tjo shape: a bad #if inside a loop over an absent list —
		// the render (empty context, empty list) passes and must NOT mask it.
		const failures = compileAndRender([
			{
				rel: "ship-creator.hbs",
				source: "{{#each hulls}}<li>{{#if ../picked.has o.uuid}}on{{/if}}</li>{{/each}}",
			},
		]);
		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("helper");
		expect(failures[0].message).toContain("{{#if}}");
		expect(failures[0].message).toContain("takes 1 argument(s), got 2");
	});

	test("handlebars parse errors are not double-counted by the helper check", () => {
		// An unclosed block compiles but throws at render. The render failure is
		// reported once; when the static helper pass re-parses and throws the
		// same "Parse error on line 1…" message, the /Parse error/ filter drops
		// that duplicate — the same problem is never counted twice.
		const failures = compileAndRender([
			{ rel: "unclosed.hbs", source: "{{#each x}}unclosed" },
		]);
		expect(failures).toHaveLength(1);
		expect(failures[0].kind).toBe("render");
		expect(failures[0].message).toContain("Parse error");
	});

	test("failures accumulate across templates: count drives the exit code", () => {
		const renderFailures = compileAndRender([
			{ rel: "ok.hbs", source: "<p>fine</p>" },
			{ rel: "broken.hbs", source: "{{#if}}{{/each}}" },
			{ rel: "bad-tab.hbs", source: '<div data-tab="x"></div>' },
		]);
		// broken.hbs hits BOTH the render pass and the (non-filtered) helper
		// pass with the same mismatch message; bad-tab.hbs is clean to the
		// render driver — its failure lives in tabsCheckSync, below.
		expect(renderFailures.map((f) => f.kind)).toEqual(["render", "helper"]);

		// The CLI concatenates the drivers and derives its exit code from the
		// combined length:
		const combined = [
			...renderFailures,
			...tabsCheckSync(
				[
					{ rel: "bad-tab.hbs", source: '<div data-tab="x"></div>' },
					{ rel: "ok.hbs", source: "<p>fine</p>" },
				],
				(sysPath) => [
					{
						owner: "src/roguetrader/sheet/actor/no-tabs-sheet.ts",
						source: `refs ${sysPath}`,
					},
				],
			),
		];
		expect(combined.length).toBeGreaterThan(0); // exit 1
	});

	test("compile error does not suppress later templates' failures", () => {
		const failures = compileAndRender([
			{ rel: "broken.hbs", source: "{{#if}}{{/each}}" },
			{ rel: "helperless.hbs", source: "{{#if a b}}x{{/if}}" },
		]);
		expect(failures.map((f) => f.kind)).toEqual([
			"render",
			"helper",
			"render",
			"helper",
		]);
		expect(failures.some((f) => f.message.startsWith("helperless.hbs"))).toBe(
			true,
		);
	});
});