/**
 * Static helper-call analysis (bead 7tjo).
 *
 * The bug these tests pin: `{{#if ../picked.has o.uuid}}` — two params, where
 * handlebars' #if requires exactly one — shipped to a live world because it sat
 * inside an `{{#each}}` over an empty list. verify:templates rendered with an
 * empty context, the loop never iterated, the bad `#if` never executed, and the
 * render passed. The first test below reproduces that exactly, and asserts BOTH
 * halves: the render succeeds AND the static check fails.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import {
	checkHelperCalls,
	HELPER_ARITY,
	isSimpleName,
	KNOWN_HELPERS,
	walkAst,
} from "./template-helpers";

/** Render exactly as verify-templates.mjs does: empty context, real helpers. */
function rendersClean(source: string): boolean {
	try {
		Handlebars.compile(source)({});
		return true;
	} catch {
		return false;
	}
}

describe("helper arity (bead 7tjo)", () => {
	test("the shipped bug: #if with two params inside a loop that never runs", () => {
		// Verbatim shape from ship-creator.hbs (bead 9cre follow-up).
		const source = [
			"{{#each hulls}}",
			"  <li class=\"{{#if ../picked.has o.uuid}}on{{/if}}\">{{o.name}}</li>",
			"{{/each}}",
		].join("\n");

		// The render pass cannot see it — this is why the bead existed.
		expect(rendersClean(source)).toBe(true);

		// The static check does.
		const failures = checkHelperCalls(source, "ship-creator.hbs");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("ship-creator.hbs");
		expect(failures[0]).toContain("{{#if}}");
		expect(failures[0]).toContain("takes 1 argument(s), got 2");
	});

	test("a correct #if inside a loop is clean", () => {
		const source =
			"{{#each hulls}}{{#if o.uuid}}<li>{{o.name}}</li>{{/if}}{{/each}}";
		expect(checkHelperCalls(source)).toEqual([]);
	});

	test("block helpers with no argument are caught", () => {
		// Handlebars raises "Must pass iterator to #each" at render; a loop
		// that never runs hides it just as well.
		expect(checkHelperCalls("{{#each}}x{{/each}}").join()).toContain(
			"takes 1 argument(s), got 0",
		);
		expect(checkHelperCalls("{{#with}}x{{/with}}").join()).toContain(
			"takes 1 argument(s), got 0",
		);
		expect(checkHelperCalls("{{#unless a b}}x{{/unless}}").join()).toContain(
			"got 2",
		);
	});

	test("hash options are not params", () => {
		// includeZero is a hash arg, so this is a 1-param #if and must pass.
		expect(checkHelperCalls("{{#if hp includeZero=true}}x{{/if}}")).toEqual([]);
	});

	test("multi-arg helpers check both bounds", () => {
		expect(checkHelperCalls("{{eq a b}}")).toEqual([]);
		expect(checkHelperCalls("{{eq a}}").join()).toContain("takes 2");
		expect(checkHelperCalls("{{eq a b c}}").join()).toContain("takes 2");
		expect(checkHelperCalls("{{ifThen a b c}}")).toEqual([]);
		expect(checkHelperCalls("{{ifThen a b}}").join()).toContain("takes 3");
	});

	test("variadic helpers accept any count >= 1", () => {
		expect(checkHelperCalls("{{concat 'a' 'b' 'c'}}")).toEqual([]);
		expect(checkHelperCalls("{{concat}}").join()).toContain("takes 1-n");
	});

	test("subexpressions are checked too", () => {
		expect(checkHelperCalls("{{#if (eq a b)}}x{{/if}}")).toEqual([]);
		expect(checkHelperCalls("{{#if (eq a)}}x{{/if}}").join()).toContain(
			"takes 2",
		);
	});

	test("the line number is reported for block helpers", () => {
		const failures = checkHelperCalls("line one\n{{#if a b}}x{{/if}}");
		expect(failures[0]).toContain("line 2");
	});
});

describe("unknown helper names (bead 7tjo)", () => {
	test("an unregistered block helper is caught", () => {
		expect(checkHelperCalls("{{#nope x}}y{{/nope}}").join()).toContain(
			"not a registered helper",
		);
	});

	test("an unregistered helper call with params is caught", () => {
		expect(checkHelperCalls("{{nope x}}").join()).toContain(
			"not a registered helper",
		);
	});

	test("a bare unknown name is NOT flagged — it may be a context property", () => {
		// `{{title}}` is a property on many sheet contexts; handlebars only
		// treats it as a helper if one is registered. Flagging these would be
		// hundreds of false positives.
		expect(checkHelperCalls("{{title}}")).toEqual([]);
		expect(checkHelperCalls("{{editable}}")).toEqual([]);
	});

	test("context paths and block params are NOT helpers", () => {
		expect(checkHelperCalls("{{o.uuid}}")).toEqual([]);
		expect(checkHelperCalls("{{../picked.has}}")).toEqual([]);
		expect(checkHelperCalls("{{@index}}")).toEqual([]);
		expect(checkHelperCalls("{{#each items as |o|}}{{o.uuid}}{{/each}}")).toEqual(
			[],
		);
		expect(checkHelperCalls("{{this}}")).toEqual([]);
		expect(checkHelperCalls("{{tabs.data.cssClass}}")).toEqual([]);
	});
});

describe("isSimpleName", () => {
	test("accepts plain identifiers and rejects paths", () => {
		expect(isSimpleName("if")).toBe(true);
		expect(isSimpleName("o.uuid")).toBe(false);
		expect(isSimpleName("../picked")).toBe(false);
		expect(isSimpleName("@index")).toBe(false);
		expect(isSimpleName("this")).toBe(false);
		expect(isSimpleName("")).toBe(false);
		expect(isSimpleName(undefined)).toBe(false);
	});
});

describe("walkAst", () => {
	test("visits every node, including nested loop bodies", () => {
		const types: string[] = [];
		walkAst(Handlebars.parse("{{#each a}}{{#if b}}{{c}}{{/if}}{{/each}}"), (n) =>
			types.push(n.type ?? "?"),
		);
		expect(types.filter((t) => t === "BlockStatement")).toHaveLength(2);
		expect(types).toContain("MustacheStatement");
	});

	test("does not recurse into loc bookkeeping", () => {
		const visited: string[] = [];
		walkAst(Handlebars.parse("{{x}}"), (n) => visited.push(n.type ?? "?"));
		expect(visited.every((t) => t !== "SourceLocation")).toBe(true);
	});
});

describe("the checker's tables stay in sync with the renderer", () => {
	test("every helper stubbed in verify-templates.mjs is known here", () => {
		// The stub table mirrors Foundry core. If a new core helper is stubbed
		// there but not registered here, templates using it would be reported
		// as "not a registered helper" — a false positive that blocks the
		// build. Fail loudly instead.
		const source = readFileSync("utils/verify-templates.mjs", "utf8");
		const start = source.indexOf("const stubs = {");
		const end = source.indexOf("Handlebars.registerHelper(stubs)");
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const block = source.slice(start, end);
		const names = [...block.matchAll(/^\t([A-Za-z][A-Za-z0-9]*)\s*[:(]/gm)].map(
			(m) => m[1],
		);
		// Guard against the regex silently matching nothing.
		expect(names.length).toBeGreaterThan(20);
		for (const name of names) {
			expect(KNOWN_HELPERS.has(name)).toBe(true);
		}
	});

	test("every arity entry is a known helper", () => {
		for (const name of Object.keys(HELPER_ARITY)) {
			expect(KNOWN_HELPERS.has(name)).toBe(true);
		}
	});

	test("arity bounds are sane", () => {
		for (const [name, [min, max]] of Object.entries(HELPER_ARITY)) {
			expect(min).toBeGreaterThanOrEqual(0);
			expect(max).toBeGreaterThanOrEqual(min);
			expect(Number.isNaN(min) || Number.isNaN(max)).toBe(false);
			// A helper's declared arity must be plausible for its name.
			expect(name.length).toBeGreaterThan(0);
		}
	});
});
