/**
 * Template compile + render verification (bead 83tl).
 *
 * `bun run verify:templates` — run this instead of ad-hoc inline scripts
 * whenever touching templates or sheet context code (see AGENT-GUIDE §2a).
 *
 * What it checks:
 *   1. COMPILE — every template .hbs file compiles with handlebars (block
 *      syntax errors, unclosed helpers).
 *   2. RENDER — every template renders with the FULL stub helper set
 *      mirrored from Foundry core (client/applications/handlebars.mjs) and
 *      a permissive context (Proxy returning safe empties for anything).
 *      A render throw (missing helper, bad expression) fails loudly.
 *   2b. HELPER CALLS (static, bead 7tjo) — every helper invocation is
 *      checked against a known helper set and its arity, by walking the
 *      compiled AST. This runs INDEPENDENTLY of the render pass, which is
 *      the point: the render uses an empty context, so a body inside an
 *      `{{#each}}` over an absent list never executes and its errors are
 *      invisible to it. `{{#if ../picked.has o.uuid}}` (two params —
 *      Handlebars' #if requires exactly one) shipped to a live world
 *      precisely because verify passed on the non-executing loop.
 *   3. TABS — every template using `data-tab=` sections must belong to a
 *      sheet class that declares `static TABS`. Foundry 14 core CSS hides
 *      `.tab[data-tab]:not(.active)`; a section with a data-tab but no tab
 *      config renders permanently blank (bead kwd follow-up: the starship
 *      and dynasty sheet bodies).
 *
 * Keep the helper stubs in sync with the core helper list — if Foundry adds
 * a helper, templates using it will fail here until the stub is added, which
 * is the point (loud failure, never silent).
 */
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative, join } from "node:path";
import Handlebars from "handlebars";

// The pass/fail logic (checks 1, 2, 2b, 3) lives in utils/template-verifier.ts
// so tests can pin it without the repo (bead m8eu); this script only wires
// template contents and the sheet-owner lookup into it.

const TEMPLATE_ROOT = "template";

// ---------------------------------------------------------------------------
// Stub helpers — mirror of Foundry core (client/applications/handlebars.mjs).
// ---------------------------------------------------------------------------
const stubs = {
	localize: (key) => String(key ?? ""),
	selectOptions: (choices, opts = {}) => {
		const selected = opts?.hash?.selected;
		const entries = Array.isArray(choices)
			? choices.map((c) => [c, c])
			: Object.entries(choices ?? {});
		return entries
			.map(
				([value, label]) =>
					`<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`,
			)
			.join("");
	},
	editor: (content, opts = {}) =>
		new Handlebars.SafeString(
			`<div class="editor" data-target="${opts?.hash?.target ?? ""}"></div>`,
		),
	formInput: () => new Handlebars.SafeString("<input/>"),
	formGroup: () => new Handlebars.SafeString("<div class=form-group></div>"),
	formField: () => new Handlebars.SafeString("<div class=form-group></div>"),
	filePicker: () => new Handlebars.SafeString("<input/>"),
	ifThen: (c, a, b) => (c ? a : b),
	numberFormat: (n) => String(n ?? ""),
	numberInput: () => new Handlebars.SafeString("<input/>"),
	object: (v) => v,
	radioBoxes: () => new Handlebars.SafeString(""),
	// Foundry core's checked helper: renders checked="" when the value is
	// truthy (used by psychic.hbs psyker flag, bead hli6 follow-up).
	checked: (v) => (v ? new Handlebars.SafeString('checked="checked"') : ""),
	rangePicker: () => new Handlebars.SafeString("<input/>"),
	timeSince: (t) => String(t ?? ""),
	eq: (a, b) => a === b,
	ne: (a, b) => a !== b,
	lt: (a, b) => a < b,
	gt: (a, b) => a > b,
	lte: (a, b) => a <= b,
	gte: (a, b) => a >= b,
	not: (v) => !v,
	and() {
		return Array.prototype.every.call(arguments, Boolean);
	},
	or() {
		return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
	},
	// System-custom helpers (src/roguetrader/sheet/handlebars.ts + init.ts):
	// `config` resolves ROGUE_TRADER registries; `concat` joins path fragments.
	// If a new custom helper is registered system-side, add its stub here.
	config: () => ({}),
	concat: (...args) => args.slice(0, -1).join(""),
};

Handlebars.registerHelper(stubs);

// Static helper-call analysis (bead 7tjo) lives in utils/template-helpers.ts
// and is applied inside template-verifier.ts; the pass/fail logic (checks 1,
// 2, 2b, 3) lives in utils/template-verifier.ts (bead m8eu) so tests can drive
// it without the repo. The import below: only the wiring stays here.
import { tabsCheckSync, runRenderChecks } from "./template-verifier";

// Mirror src/roguetrader/sheet/partials.ts (consolidation beads bef7/9v7c/
// 7c1y/201f): register template/shared/parts/*.hbs as `rt/<name>` partials
// so sheet templates compile + render exactly as they will in Foundry. The
// list itself is imported from partials.ts (bead 8uyu single source of
// truth) so runtime and verify can never drift; a walk below additionally
// fails loudly if a file in template/shared/parts/ is not listed.
import { SHARED_PARTIALS } from "../src/roguetrader/sheet/partials";

{
	const sharedDir = join(TEMPLATE_ROOT, "shared/parts");
	const onDisk = new Set(
		(await readdir(sharedDir)).filter((f) => f.endsWith(".hbs")),
	);
	const listed = new Set(SHARED_PARTIALS.map((p) => p.split("/").pop()));
	for (const file of onDisk) {
		if (!listed.has(file)) {
			throw new Error(
				`verify:templates — template/shared/parts/${file} exists but is not in SHARED_PARTIALS (src/roguetrader/sheet/partials.ts); add it or remove the file.`,
			);
		}
	}
}

for (const rel of SHARED_PARTIALS) {
	const src = await readFile(join(TEMPLATE_ROOT, rel), "utf8");
	const name = `rt/${rel
		.split("/")
		.pop()
		.replace(/\.hbs$/, "")}`;
	const compiled = Handlebars.compile(src);
	// Block partials ({{> @partial-block}}) render fine at their call sites;
	// render-verify them with a visible stub so a standalone render still
	// succeeds loudly.
	if (src.includes("@partial-block")) {
		Handlebars.registerPartial(
			"@partial-block",
			Handlebars.compile("<!-- block-stub -->"),
		);
	}
	Handlebars.registerPartial(name, compiled);
}

// Loud drift check: every file in template/shared/parts/ must be listed in
// SHARED_PARTIALS (bead 8uyu) — an unlisted partial would skip verification.
{
	const sharedDir = join(TEMPLATE_ROOT, "shared/parts");
	const onDisk = new Set(
		(await readdir(sharedDir)).filter((f) => f.endsWith(".hbs")),
	);
	const listed = new Set(SHARED_PARTIALS.map((p) => p.split("/").pop()));
	for (const file of onDisk) {
		if (!listed.has(file)) {
			throw new Error(
				`verify:templates — template/shared/parts/${file} exists but is not in SHARED_PARTIALS (src/roguetrader/sheet/partials.ts); add it or remove the file.`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Render context: a plain empty object. Missing keys resolve to undefined and
// render empty (Handlebars short-circuits nested paths), while helper and
// expression errors still surface. A Proxy context would trigger handlebars'
// prototype-access denials for every property, flooding the output.
// ---------------------------------------------------------------------------
const CONTEXT = {};

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (entry.name.endsWith(".hbs")) out.push(full);
	}
	return out;
}

/**
 * Check 3 input wiring (bead m8eu): resolve a system template path to the
 * sheet files whose source references it. Pure logic in template-verifier.ts.
 */
function findSheetOwners(sysPath) {
	const owners = execSync(`grep -rl "${sysPath}" src/roguetrader/sheet/ || true`)
		.toString()
		.trim()
		.split("\n")
		.filter(Boolean);
	return owners.map((owner) => ({ owner, source: readFileSync(owner, "utf8") }));
}

const templates = await walk(TEMPLATE_ROOT);
const checked = await Promise.all(
	templates.map(async (file) => ({
		rel: relative(TEMPLATE_ROOT, file).replaceAll("\\", "/"),
		source: await readFile(file, "utf8"),
	})),
);

// Checks 1, 2, 2b (compile / render / static helper calls).
const failures = [
	...runRenderChecks(
		checked,
		(source) => Handlebars.compile(source),
		(template, context) => template(context),
		CONTEXT,
	),
	// 3. data-tab / TABS cross-check.
	...tabsCheckSync(checked, findSheetOwners),
];

for (const failure of failures) {
	console.error(`✗ ${failure.prefix}${failure.message}`);
}

console.log(
	`verify:templates — ${templates.length} templates checked, ${failures.length} failure(s)`,
);
if (failures.length > 0) process.exit(1);
