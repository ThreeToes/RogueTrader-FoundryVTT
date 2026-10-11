/**
 * Architecture boundary test (epic kof0, phase 0).
 *
 * The rules engine is layered (docs/ARCHITECTURE.md) and the layers only
 * depend INWARD. That is easy to state and easy to erode, so this test reads
 * the source and fails loudly on any import or Foundry-global use that breaks
 * the contract. It runs under `bun test` like everything else — no new tooling.
 *
 * The rules, in one place:
 *   kernel         -> kernel only; no Foundry, no other layer
 *   domain         -> kernel, domain; no Foundry, no data/sheet/rules
 *   application    -> kernel, domain, application; no Foundry
 *   infrastructure -> anything below + Foundry (it implements the ports)
 *   presentation   -> anything below + Foundry
 *   rules          -> anything below + Foundry, except that rules files outside
 *                     the FOUNDRY_COUPLED_RULES allowlist (1 file) must stay
 *                     Foundry-free
 *   bootstrap      -> everything + Foundry (the composition root)
 *
 * Layers that do not exist yet are simply not scanned, so this test is green
 * from day one and tightens automatically as the new directories appear.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Layer =
	| "kernel"
	| "domain"
	| "application"
	| "infrastructure"
	| "presentation"
	| "rules"
	| "bootstrap"
	| "other";

/** Directory -> layer. Order matters: first match wins. */
const LAYER_DIRS: ReadonlyArray<readonly [Layer, string]> = [
	["kernel", "src/rules-engine"],
	["domain", "src/ffg/domain"],
	["application", "src/ffg/application"],
	["presentation", "src/ffg/presentation"],
	["infrastructure", "src/ffg/infrastructure"],
	["infrastructure", "src/roguetrader/infrastructure"],
	["presentation", "src/roguetrader/presentation"],
	["presentation", "src/roguetrader/sheet"],
	["rules", "src/roguetrader/rules"],
	["bootstrap", "src/roguetrader/bootstrap"],
];

/** Layers each layer is allowed to depend on. */
const ALLOWED: Readonly<Record<Layer, readonly Layer[]>> = {
	kernel: ["kernel"],
	domain: ["kernel", "domain"],
	application: ["kernel", "domain", "application"],
	infrastructure: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"other",
	],
	presentation: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"rules",
		"other",
	],
	// rules -> presentation is a known inversion: rules/roll-system.ts is a
	// re-export shim over presentation/rolls. The pure-rules guarantee is
	// enforced by the Foundry-global check with FOUNDRY_COUPLED_RULES instead.
	rules: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"rules",
		"other",
	],
	bootstrap: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"rules",
		"bootstrap",
		"other",
	],
	other: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"rules",
		"bootstrap",
		"other",
	],
};

/** Layers that must stay Foundry-free and self-contained. */
const INNER: readonly Layer[] = ["kernel", "domain", "application"];

/**
 * rules/ files that are legitimately Foundry-coupled: the adapter edge.
 * Everything else under rules/ must stay Foundry-free (bead 5xue).
 *
 * The check scans each file's OWN source text (it does not follow re-exports),
 * so a pure re-export shim passes without an entry: battlesuit-repair.ts left
 * the allowlist in bead ap2j (translations moved to the i18n port) and
 * roll-system.ts in bead k8ay (it is now a pure re-export over
 * presentation/rolls) — neither may use a Foundry global in its own code.
 */
const FOUNDRY_COUPLED_RULES: ReadonlySet<string> = new Set([
	"src/roguetrader/rules/adapter.ts",
	// test-dialog.ts left the allowlist in bead p7jv: the Foundry-coupled
	// machinery moved to src/ffg/infrastructure/foundry/test-dialog.ts and the
	// remaining shim is pure RT data (branding + difficulty ladder).
]);

/** Foundry globals an inner layer may never touch (identifier + access). */
const FOUNDRY_GLOBAL =
	/\b(foundry|game|CONFIG|ui|Hooks|canvas)\s*(?:\.|\?\.|\[|\()/;

function classify(file: string): Layer {
	const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
	for (const [layer, dir] of LAYER_DIRS) {
		if (rel === dir || rel.startsWith(`${dir}/`)) return layer;
	}
	return "other";
}

function collect(dir: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out; // layer not created yet
	}
	for (const entry of entries) {
		const file = path.join(dir, entry);
		if (statSync(file).isDirectory()) {
			out.push(...collect(file));
		} else if (file.endsWith(".ts") && !file.endsWith(".test.ts")) {
			out.push(file);
		}
	}
	return out;
}

/**
 * Blank out comments — and, when `blankStrings`, string bodies too — so a
 * scan cannot be fooled by prose or string literals, while preserving newlines
 * for line numbers.
 *
 * One scanner for both jobs (bead w9sa.4 added the string-preserving mode): the
 * Foundry-global check wants strings GONE, and the sibling-id check wants them
 * KEPT, because an id that reaches the shared layer as data arrives as a string
 * literal. Two nearly-identical hand-rolled scanners would drift.
 */
function blankCommentsAndStrings(
	source: string,
	blankStrings: boolean,
): string {
	let out = "";
	let i = 0;
	while (i < source.length) {
		const c = source[i];
		const d = source[i + 1];
		if (c === "/" && d === "/") {
			while (i < source.length && source[i] !== "\n") {
				out += " ";
				i++;
			}
			continue;
		}
		if (c === "/" && d === "*") {
			out += "  ";
			i += 2;
			while (
				i < source.length &&
				!(source[i] === "*" && source[i + 1] === "/")
			) {
				out += source[i] === "\n" ? "\n" : " ";
				i++;
			}
			out += "  ";
			i += 2;
			continue;
		}
		if (c === "'" || c === '"' || c === "`") {
			out += " ";
			i++;
			while (i < source.length && source[i] !== c) {
				if (source[i] === "\\") {
					out += blankStrings ? "  " : source.slice(i, i + 2);
					i += 2;
					continue;
				}
				out += !blankStrings || source[i] === "\n" ? source[i] : " ";
				i++;
			}
			out += " ";
			i++;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

function stripCommentsAndStrings(source: string): string {
	return blankCommentsAndStrings(source, true);
}

/** Comments gone, string bodies kept — the mode an id-as-data scan needs. */
function stripComments(source: string): string {
	return blankCommentsAndStrings(source, false);
}

function lineAt(source: string, index: number): number {
	return source.slice(0, index).split("\n").length;
}

function importSpecs(source: string): Array<{ spec: string; line: number }> {
	const out: Array<{ spec: string; line: number }> = [];
	const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
	let match = re.exec(source);
	while (match) {
		out.push({ spec: match[1], line: lineAt(source, match.index) });
		match = re.exec(source);
	}
	return out;
}

/** Every architecture violation in one file (empty = clean). */
export function violationsFor(file: string, source: string): string[] {
	const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
	const layer = classify(file);
	const allowed = ALLOWED[layer];
	const violations: string[] = [];

	for (const { spec, line } of importSpecs(source)) {
		if (spec.startsWith(".")) {
			const target = classify(path.resolve(path.dirname(file), spec));
			if (!allowed.includes(target)) {
				violations.push(
					`${file}:${line} imports "${spec}" (${target}) — ${layer} may not depend on ${target}`,
				);
			}
		} else if (INNER.includes(layer) && !spec.startsWith("bun:")) {
			violations.push(
				`${file}:${line} bare import "${spec}" — ${layer} may only import relative modules`,
			);
		}
	}

	if (
		INNER.includes(layer) ||
		(layer === "rules" && !FOUNDRY_COUPLED_RULES.has(rel))
	) {
		const stripped = stripCommentsAndStrings(source);
		const match = FOUNDRY_GLOBAL.exec(stripped);
		if (match) {
			violations.push(
				`${file}:${lineAt(stripped, match.index)} uses Foundry global "${match[1]}" — ${layer} must take it from a port instead`,
			);
		}
	}

	return violations;
}

// ---------------------------------------------------------------------------
// Shared-layer neutrality (bead w9sa.4)
// ---------------------------------------------------------------------------

/**
 * The sibling system's id, in BOTH spellings.
 *
 * `src/ffg/**` and `src/rules-engine/**` are the shared core: RT boots through
 * them and so does Dark Heresy 2nd Edition (its composition root is
 * `src/dark_heresy_2e/bootstrap/index.ts`). A shared module that NAMES the
 * sibling is one `systemId === "dark-heresy-2e"` branch away from a fork, and
 * the whole point of the sibling boot (epic hr6r: reuse, do not fork) is that
 * no such branch is ever needed — the sibling reaches the shared layer through
 * the two seams (the widened config port, the knob registry) and passes its own
 * data in.
 *
 * Both spellings matter because Foundry ids are hyphenated
 * (`dark-heresy-2e`, what `templateRootFor` and the registry carry) while
 * package directories are underscored (`dark_heresy_2e`, the release folder).
 * A literal of either shape is the same coupling.
 */
const SIBLING_SYSTEM_IDS = /dark[-_]heresy/g;

/** The trees that must never name the sibling system. */
const SHARED_LAYER_DIRS: readonly string[] = ["src/ffg", "src/rules-engine"];

/**
 * The ONE shared-layer file that may name the sibling as data:
 * `rule-knobs-dark-heresy.ts` declares `DH2_SYSTEM_ID` beside the DH2 registry
 * it identifies (closed bead w9sa.3), and `RuleKnobRegistry.systemId` is what
 * `ruleProfilePackKindFor` derives the cross-system pack kind from — the value
 * has to live somewhere the shared machinery can read.
 *
 * It is allowlisted, not ignored: the list has exactly one entry, so no OTHER
 * shared file may grow the sibling's name, and the entry is a documented
 * escalation to the owner (moving that constant into the sibling module needs a
 * decision, because domain may not import a sibling system's module and the
 * registry object is built in that file).
 */
const SIBLING_ID_ALLOWLIST: ReadonlySet<string> = new Set([
	"src/ffg/domain/rule-knobs-dark-heresy.ts",
]);

/**
 * Every place one file names the sibling system's id (empty = neutral).
 *
 * Comments are stripped and string bodies KEPT: a prose mention of the sibling
 * in a doc comment is how the shared layer explains WHY it is neutral, while a
 * string literal is the sibling's id arriving as data.
 */
export function siblingIdViolationsFor(file: string, source: string): string[] {
	const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
	if (SIBLING_ID_ALLOWLIST.has(rel)) return [];
	const stripped = stripComments(source);
	const violations: string[] = [];
	for (
		let match = SIBLING_SYSTEM_IDS.exec(stripped);
		match;
		match = SIBLING_SYSTEM_IDS.exec(stripped)
	) {
		violations.push(
			`${rel}:${lineAt(stripped, match.index)} names the sibling system ("${match[0]}") — the shared layers must stay system-neutral; DH2-specific data belongs in src/dark_heresy_2e/** or is passed in through a seam`,
		);
	}
	SIBLING_SYSTEM_IDS.lastIndex = 0;
	return violations;
}

describe("architecture boundaries (epic kof0)", () => {
	test("every layer only depends inward, and inner layers are Foundry-free", () => {
		const files = LAYER_DIRS.flatMap(([, dir]) => collect(dir));
		const violations = files.flatMap((file) =>
			violationsFor(file, readFileSync(file, "utf8")),
		);
		expect(violations).toEqual([]);
	});

	test("the scanner flags a Foundry import in domain", () => {
		const violations = violationsFor(
			"src/ffg/domain/x.ts",
			'import type { Actor } from "fvtt-types";\n',
		);
		expect(violations.length).toBeGreaterThan(0);
	});

	test("the scanner flags a Foundry global in the kernel", () => {
		const violations = violationsFor(
			"src/rules-engine/x.ts",
			'export const name = game.i18n.localize("X");\n',
		);
		expect(violations.some((v) => v.includes("Foundry global"))).toBe(true);
	});

	test("the scanner ignores Foundry words in comments and strings", () => {
		const violations = violationsFor(
			"src/rules-engine/x.ts",
			'// uses game.i18n at the edge\nexport const label = "game.i18n";\n',
		);
		expect(violations).toEqual([]);
	});

	test("the scanner flags domain importing application", () => {
		const violations = violationsFor(
			"src/ffg/domain/x.ts",
			'import { performRoll } from "../../application/rolls";\n',
		);
		expect(violations.some((v) => v.includes("may not depend on"))).toBe(true);
	});

	test("the scanner allows an inward kernel import", () => {
		const violations = violationsFor(
			"src/rules-engine/damage.ts",
			'import type { RuleProfile } from "./profile";\n',
		);
		expect(violations).toEqual([]);
	});

	test("the scanner flags a Foundry global in a non-allowlisted rules file", () => {
		const violations = violationsFor(
			"src/roguetrader/rules/x.ts",
			'export const name = game.i18n.localize("X");\n',
		);
		expect(violations.some((v) => v.includes("Foundry global"))).toBe(true);
	});

	test("the scanner allows an allowlisted rules file to use Foundry", () => {
		const violations = violationsFor(
			"src/roguetrader/rules/adapter.ts",
			"export const doc = foundry.utils.fromUuidSync(uuid);\n",
		);
		expect(violations).toEqual([]);
	});

	test("the scanner allows infrastructure to use Foundry", () => {
		const violations = violationsFor(
			"src/roguetrader/infrastructure/foundry/dice.ts",
			'import type { Actor } from "fvtt-types";\nexport const r = new foundry.dice.Roll("1d100");\n',
		);
		expect(violations).toEqual([]);
	});
});

describe("shared-layer neutrality (bead w9sa.4)", () => {
	test("src/ffg and src/rules-engine never name the sibling system", () => {
		// The invariant the sibling boot depends on: the shared core carries NO
		// "dark-heresy" / "dark_heresy" literal, so DH2 reaches it only through
		// the config port and the knob registry. One allowlisted file (the DH2
		// registry's own systemId, closed bead w9sa.3) is the single exception and
		// is documented where it is declared above.
		const violations = SHARED_LAYER_DIRS.flatMap((dir) =>
			collect(dir).flatMap((file) =>
				siblingIdViolationsFor(file, readFileSync(file, "utf8")),
			),
		);
		expect(violations).toEqual([]);
	});

	test("the allowlist holds exactly one entry, and it is the DH2 registry", () => {
		// A growing allowlist is how the invariant dies quietly, so its size is
		// pinned. Adding an entry is a decision for the owner, not a fix.
		expect([...SIBLING_ID_ALLOWLIST]).toEqual([
			"src/ffg/domain/rule-knobs-dark-heresy.ts",
		]);
		const registry = readFileSync(
			"src/ffg/domain/rule-knobs-dark-heresy.ts",
			"utf8",
		);
		expect(
			siblingIdViolationsFor(
				"src/ffg/domain/rule-knobs-dark-heresy.ts",
				registry,
			),
		).toEqual([]);
		// The allowlisted file names the sibling exactly TWICE, and both are
		// structural: the import specifier of DH2's own profile module and the
		// DH2_SYSTEM_ID declaration the registry is built from. A THIRD is a new
		// coupling and fails here.
		expect(stripComments(registry).match(SIBLING_SYSTEM_IDS)?.length).toBe(2);
	});

	test("the scanner flags a sibling id literal in the shared domain", () => {
		const violations = siblingIdViolationsFor(
			"src/ffg/domain/x.ts",
			'export const ID = "dark-heresy-2e";\n',
		);
		expect(violations.length).toBe(1);
		expect(violations[0]).toContain("names the sibling system");
	});

	test("the scanner flags the underscored spelling too", () => {
		const violations = siblingIdViolationsFor(
			"src/rules-engine/x.ts",
			'export const dir = "systems/dark_heresy_2e/template/";\n',
		);
		expect(violations.length).toBe(1);
	});

	test("the scanner ignores the sibling's name in a comment", () => {
		// Documenting WHY the shared layer is neutral must not trip the guard.
		const violations = siblingIdViolationsFor(
			"src/ffg/domain/x.ts",
			'// dark-heresy-2e supplies its own profile through the config port\nexport const id = "rt-core";\n',
		);
		expect(violations).toEqual([]);
	});
});
