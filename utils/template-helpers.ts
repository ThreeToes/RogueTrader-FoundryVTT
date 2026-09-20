/**
 * Static helper-call analysis for handlebars templates (bead 7tjo).
 *
 * Lives outside verify-templates.mjs so it can be unit-tested: the reported
 * bug shipped precisely because the checker and its only test were the same
 * "does it render?" question, which passes vacuously when the offending line
 * sits inside a loop that never executes.
 *
 * WHY STATIC RATHER THAN A DEEPER RENDER CONTEXT: the render pass runs with an
 * EMPTY context, so `{{#each absent}}` never iterates and its body is never
 * executed — an error there cannot be observed by rendering, only by making
 * the loop run. A "deep probe" context was tried first and rejected:
 * handlebars' lookupProperty() THROWS on the dangerous names (toString,
 * valueOf, constructor, hasOwnProperty...) unless they are OWN properties of
 * the parent, so a permissive Proxy must also fabricate own descriptors for
 * exactly those names — and any set it fabricates is a guess, which becomes
 * spurious failures that block the build.
 *
 * Walking the AST is context-independent: it sees every helper call in the
 * file whether or not the surrounding loop ever executes. That is strictly
 * stronger than a probe render for the class of bug this is about — a helper
 * invoked with the wrong number of arguments, or not registered at all.
 */
import Handlebars from "handlebars";

/**
 * Param-count bounds for helpers whose signature is fixed. Hash options
 * (`key=value`) are not params, so they never count here.
 *
 * Builtins come from handlebars' own lib/handlebars/helpers/*; the rest mirror
 * the stub table in verify-templates.mjs (which mirrors Foundry core,
 * client/applications/handlebars.mjs) plus the system's registerHelper calls
 * in src/roguetrader/sheet/handlebars.ts (`config`, `concat`).
 */
export const HELPER_ARITY: Readonly<Record<string, readonly [number, number]>> =
	{
		// handlebars builtins
		if: [1, 1],
		unless: [1, 1],
		each: [1, 1],
		with: [1, 1],
		lookup: [2, 2],
		log: [0, Number.POSITIVE_INFINITY],
		// Foundry core
		localize: [1, 2],
		selectOptions: [1, 2],
		editor: [1, 2],
		formInput: [0, 1],
		formGroup: [0, 1],
		formField: [0, 1],
		filePicker: [0, 1],
		numberInput: [0, 1],
		numberFormat: [1, 1],
		radioBoxes: [1, 2],
		rangePicker: [0, 1],
		checked: [1, 1],
		timeSince: [1, 1],
		// system
		config: [1, 2],
		concat: [1, Number.POSITIVE_INFINITY],
		// comparison / boolean helpers
		eq: [2, 2],
		ne: [2, 2],
		lt: [2, 2],
		gt: [2, 2],
		lte: [2, 2],
		gte: [2, 2],
		not: [1, 1],
		and: [1, Number.POSITIVE_INFINITY],
		or: [1, Number.POSITIVE_INFINITY],
		ifThen: [3, 3],
		object: [1, 1],
	};

/**
 * Helpers the renderer is expected to resolve. Anything else is a typo.
 *
 * Derived from HELPER_ARITY rather than re-listed, so the two cannot drift.
 * template-helpers.test.ts additionally asserts this covers every name in
 * verify-templates.mjs's stub table, which is the one place that mirrors
 * Foundry core — a new core helper must be added there AND here, loudly.
 */
export const KNOWN_HELPERS: ReadonlySet<string> = new Set([
	...Object.keys(HELPER_ARITY),
	// handlebars' own resolution fallbacks, which a template may name
	// explicitly to customise missing-helper behaviour.
	"blockHelperMissing",
	"helperMissing",
]);

interface AstNode {
	type?: string;
	path?: { original?: string };
	params?: unknown[];
	loc?: { start?: { line?: number } };
	[key: string]: unknown;
}

/** Depth-first walk over a handlebars AST (nodes are plain objects). */
export function walkAst(node: unknown, visit: (node: AstNode) => void): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) walkAst(child, visit);
		return;
	}
	const record = node as AstNode;
	if (typeof record.type === "string") visit(record);
	for (const [key, value] of Object.entries(record)) {
		// `loc` is line/column bookkeeping, not a child node.
		if (key === "loc" || key === "type") continue;
		walkAst(value, visit);
	}
}

/** A helper name, as opposed to a context path (`o.uuid`) or data (`@index`). */
export function isSimpleName(path: unknown): path is string {
	return (
		typeof path === "string" &&
		path.length > 0 &&
		!/[./@\\]/.test(path) &&
		path !== "this"
	);
}

/**
 * Check every helper call in one template source. Returns failure strings,
 * empty when the template is clean.
 *
 * A bare `{{foo}}` is ambiguous — handlebars resolves it as a helper if one is
 * registered, else as a context property — so an unknown name is only reported
 * when the call CANNOT be a property lookup: a block `{{#foo}}`, a call with
 * params `{{foo bar}}`, or a subexpression `(foo bar)`.
 */
export function checkHelperCalls(source: string, rel = "template"): string[] {
	const failures: string[] = [];
	walkAst(Handlebars.parse(source), (node) => {
		const isBlock = node.type === "BlockStatement";
		const isSub = node.type === "SubExpression";
		if (!isBlock && !isSub && node.type !== "MustacheStatement") return;

		const name = node.path?.original;
		if (!isSimpleName(name)) return;

		const params = node.params?.length ?? 0;
		const looksLikeHelper = isBlock || isSub || params > 0;

		if (!KNOWN_HELPERS.has(name)) {
			if (looksLikeHelper) {
				failures.push(
					`${rel}: {{${isBlock ? "#" : ""}${name}}} is not a registered helper (block/params make it a helper call, not a context lookup).`,
				);
			}
			return;
		}

		const arity = HELPER_ARITY[name];
		if (!arity) return;
		const [min, max] = arity;
		if (params < min || params > max) {
			const expected =
				min === max
					? `${min}`
					: `${min}-${max === Number.POSITIVE_INFINITY ? "n" : max}`;
			failures.push(
				`${rel}: {{${isBlock ? "#" : ""}${name}}} takes ${expected} argument(s), got ${params}${isBlock ? ` (line ${node.loc?.start?.line ?? "?"})` : ""}.`,
			);
		}
	});
	return failures;
}
