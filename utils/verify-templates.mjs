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
import { execSync } from "node:child_process";
import { relative, join } from "node:path";
import Handlebars from "handlebars";

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

// Mirror src/roguetrader/sheet/partials.ts (consolidation beads bef7/9v7c/
// 7c1y/201f): register template/shared/parts/*.hbs as `rt/<name>` partials
// so sheet templates compile + render exactly as they will in Foundry. The
// list itself is imported from partials.ts (bead 8uyu single source of
// truth) so runtime and verify can never drift; a walk below additionally
// fails loudly if a file in template/shared/parts/ is not listed.
import { SHARED_PARTIALS } from "../src/roguetrader/sheet/partials";

{
	const sharedDir = join(TEMPLATE_ROOT, "shared/parts");
	const onDisk = new Set((await readdir(sharedDir)).filter((f) => f.endsWith(".hbs")));
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
	const name = `rt/${rel.split("/").pop().replace(/\.hbs$/, "")}`;
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
 * Check 3: data-tab sections must belong to sheets declaring static TABS
 * (or bind tabs.*.cssClass, which implies a proper TABS config upstream).
 */
async function tabsCheck(templates) {
	const failures = [];
	for (const file of templates) {
		const html = await readFile(file, "utf8");
		if (!/data-tab=/.test(html)) continue;
		if (/tabs\.[a-zA-Z.]+\.cssClass/.test(html)) continue; // proper binding
		const rel = relative(TEMPLATE_ROOT, file).replaceAll("\\", "/");
		const sysPath = `systems/rogue-trader/template/${rel}`;
		const owners = execSync(
			`grep -rl "${sysPath}" src/roguetrader/sheet/ || true`,
		)
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean);
		if (owners.length === 0) continue; // not referenced by a sheet (partial)
		for (const owner of owners) {
			const src = await readFile(owner, "utf8");
			if (!/static\s+TABS\s*=/.test(src)) {
				failures.push(
					`${rel} -> ${owner}: template uses data-tab sections but the sheet declares no static TABS (body renders display:none under Foundry 14 core CSS).`,
				);
			}
		}
	}
	return failures;
}

const templates = await walk(TEMPLATE_ROOT);
let failures = 0;

for (const file of templates) {
	const rel = relative(TEMPLATE_ROOT, file);
	const source = await readFile(file, "utf8");
	// 1. Compile.
	try {
		Handlebars.compile(source);
	} catch (error) {
		failures++;
		console.error(`✗ compile ${rel}: ${error.message}`);
		continue;
	}
	// 2. Render with stub helpers + empty context.
	try {
		const template = Handlebars.compile(source);
		const html = template(CONTEXT);
		if (typeof html !== "string") throw new Error("render produced no output");
	} catch (error) {
		failures++;
		console.error(`✗ render  ${rel}: ${error.message}`);
	}
}

// 3. data-tab / TABS cross-check.
for (const failure of await tabsCheck(templates)) {
	failures++;
	console.error(`✗ tabs    ${failure}`);
}

console.log(
	`verify:templates — ${templates.length} templates checked, ${failures} failure(s)`,
);
if (failures > 0) process.exit(1);