/**
 * Pure checker pieces for verify-templates.mjs (bead m8eu), extracted so they
 * can be unit-tested — mirroring the template-helpers.ts precedent (bead 7tjo).
 *
 * The reported regression class (bead 83tl): the tab-check in the QA-gate
 * script was silently neutered (its execSync grep returned nothing / its
 * regex tightened) and the guard then passed forever, letting the Foundry 14
 * "section with data-tab but no static TABS renders display:none" bug ship
 * with a green build. Keeping the checker here, parameterised over its
 * inputs, lets tests pin each case it must still catch.
 *
 * The CLI script (verify-templates.mjs) owns nothing but wiring: walking the
 * template tree, registering stub helpers/partials, and printing failures.
 * Everything that decides pass/fail lives here and is pure: it receives the
 * template contents and a sheet-owner lookup instead of reading the repo.
 */
import { checkHelperCalls } from "./template-helpers";

/** A template under verification, keyed by path relative to template/. */
export interface TemplateSource {
	rel: string;
	source: string;
}

/** A sheet class file that references a template (its potential tab owner). */
export interface SheetOwner {
	owner: string;
	source: string;
}

/** One verifier failure, pre-shaped for the CLI's `✗ <prefix><message>` line. */
export interface TemplateFailure {
	kind: "compile" | "render" | "helper" | "tabs";
	/** Exact column-aligned prefix the CLI prints (compile/render/helper/tabs). */
	prefix: string;
	message: string;
}

/**
 * Check 3: data-tab sections must belong to sheets declaring static TABS
 * (or bind tabs.*.cssClass, which implies a proper TABS config upstream).
 *
 * `lookupOwners` must return the sheet files whose source references the
 * given system template path; an empty result means "not referenced by any
 * sheet" (a partial) and the template is skipped.
 */
export function tabsCheckSync(
	templates: readonly TemplateSource[],
	lookupOwners: (sysPath: string) => readonly SheetOwner[],
): TemplateFailure[] {
	const failures: TemplateFailure[] = [];
	for (const { rel, source } of templates) {
		if (!/data-tab=/.test(source)) continue;
		if (/tabs\.[a-zA-Z.]+\.cssClass/.test(source)) continue; // proper binding
		const sysPath = `systems/rogue-trader/template/${rel}`;
		const owners = lookupOwners(sysPath);
		if (owners.length === 0) continue; // not referenced by a sheet (partial)
		for (const { owner, source: ownerSource } of owners) {
			if (!/static\s+TABS\s*=/.test(ownerSource)) {
				failures.push({
					kind: "tabs",
					prefix: "tabs    ",
					message: `${rel} -> ${owner}: template uses data-tab sections but the sheet declares no static TABS (body renders display:none under Foundry 14 core CSS).`,
				});
			}
		}
	}
	return failures;
}

/**
 * Checks 1, 2 and 2b for a list of templates: compile, render and static
 * helper-call analysis, accumulating every failure instead of short-circuiting
 * (a template with several problems reports all of them; the CLI derives the
 * exit code from the returned count).
 *
 * `compile`/`render` are injected so tests can drive the accumulation without
 * the repo: the CLI passes Handlebars.compile and `((t, ctx) => t(ctx))`.
 */
export function runRenderChecks(
	templates: readonly TemplateSource[],
	compile: (source: string) => unknown,
	render: (compiled: unknown, context: unknown) => unknown,
	context: unknown,
): TemplateFailure[] {
	const failures: TemplateFailure[] = [];
	for (const { rel, source } of templates) {
		// 1. Compile.
		let compiled: unknown;
		try {
			compiled = compile(source);
		} catch (error) {
			failures.push({
				kind: "compile",
				prefix: "compile ",
				message: `${rel}: ${(error as Error).message}`,
			});
			continue;
		}
		// 2. Render with stub helpers + the shared context.
		try {
			const html = render(compiled, context);
			if (typeof html !== "string") throw new Error("render produced no output");
		} catch (error) {
			failures.push({
				kind: "render",
				prefix: "render  ",
				message: `${rel}: ${(error as Error).message}`,
			});
		}
		// 2b. Static helper-call check. Deliberately NOT inside the render try:
		// it must run even when the render passed, because passing is exactly the
		// failure mode (an unexecuted loop body hides its own errors).
		try {
			for (const failure of checkHelperCalls(source, rel)) {
				failures.push({
					kind: "helper",
					prefix: "helper  ",
					message: failure,
				});
			}
		} catch (error) {
			// Handlebars.parse throws on syntax errors, which the compile pass
			// above has already reported; do not double-count them.
			if (!/Parse error/.test((error as Error).message)) {
				failures.push({
					kind: "helper",
					prefix: "helper  ",
					message: `${rel}: ${(error as Error).message}`,
				});
			}
		}
	}
	return failures;
}