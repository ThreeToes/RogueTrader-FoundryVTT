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

/**
 * Walk a directory tree for source files.
 *
 * `includeTests` defaults to FALSE: the sibling-id and walk-locality scans use
 * that default (see their doc comments). The boundary scan opts IN (bead
 * poq3) — a `*.test.ts` file is source too, and it was the one place a
 * domain -> application import could hide from this test.
 */
function collect(dir: string, includeTests = false): string[] {
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
			out.push(...collect(file, includeTests));
		} else if (file.endsWith(".ts") && (includeTests || !file.endsWith(".test.ts"))) {
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

/**
 * True when `index` sits inside a string literal or comment in `source`, using
 * the SAME literal/comment rules as blankCommentsAndStrings — the two scanners
 * cannot be allowed to disagree about a quote.
 *
 * importSpecs needs this now that test files are scanned (bead poq3): an
 * assertion like `.toContain('from "../pack-doc-links"')` quotes an import
 * statement inside a STRING — prose about an import, not an import — and
 * without the span check it invents a violation.
 *
 * KNOWN HOLE: the scan is a plain character walk — a quote-bearing REGEX
 * literal in scanned code would desync the string/comment tracking (the
 * regex's quotes are read as string delimiters). No rule data uses that
 * shape today; if one lands, the filter mislabels spans it tracks.
 */
function insideStringOrComment(source: string, index: number): boolean {
	let quote: string | null = null;
	let block = false;
	let i = 0;
	while (i < source.length && i < index) {
		const c = source[i];
		const d = source[i + 1];
		if (block) {
			if (c === "*" && d === "/") {
				block = false;
				i += 2;
			} else i++;
			continue;
		}
		if (quote) {
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === quote) quote = null;
			i++;
			continue;
		}
		if (c === "/" && d === "/") {
			const nl = source.indexOf("\n", i);
			i = nl === -1 ? source.length : nl + 1;
			continue;
		}
		if (c === "/" && d === "*") {
			block = true;
			i += 2;
			continue;
		}
		if (c === "'" || c === '"' || c === "`") {
			quote = c;
			i++;
			continue;
		}
		i++;
	}
	return block || quote !== null;
}

function importSpecs(source: string): Array<{ spec: string; line: number }> {
	const out: Array<{ spec: string; line: number }> = [];
	const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
	let match = re.exec(source);
	while (match) {
		// A `from "…"` token inside a string or comment is prose ABOUT an import
		// (test assertions quote import statements); the specifier regex cannot
		// tell, so drop matches inside the literals/comments this importSpecs
		// scan walks.
		if (!insideStringOrComment(source, match.index)) {
			out.push({ spec: match[1], line: lineAt(source, match.index) });
		}
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
		} else if (
			INNER.includes(layer) &&
			!spec.startsWith("bun:") &&
			// bead poq3: a test HARNESS inside an inner layer may use node
			// builtins (reading fixture source files with node:fs is the norm);
			// the shipped layer source keeps the relative-only rule.
			!(rel.endsWith(".test.ts") && spec.startsWith("node:"))
		) {
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

/**
 * Boundary debt in TEST files, pinned when collect() began scanning *.test.ts
 * (bead poq3). Each entry is a REAL layer inversion in a test file that
 * predates the scanner covering tests — restructuring those tests is a bead
 * of its own, so they are PINNED here (counted and visible, not allowlisted
 * away): a NEW violation in any test file fails the scan, and removing an
 * entry requires actually fixing the import. Do not extend.
 *
 * Keys are violation strings with line numbers stripped (tests shift lines);
 * the full text is preserved in the scan failure output.
 */
function violationKey(violation: string): string {
	return violation.replace(/:\d+ /, " ");
}

/**
 * The pinned test-file boundary debt, sorted. Each entry's reason lives in
 * the entry's home suite; the debt itself is bead poq3's report to the owner:
 *
 * - system-profile-dark-heresy.test.ts: a DOMAIN test imports DH2's advance
 *   cost tables (SCHEME_TIERS et al) from roguetrader/rules/advancement.
 * - pack-doc-links.test.ts: an APPLICATION test imports the AdvanceRowLike
 *   type from roguetrader/rules/advancement ("verbatim from the advancement
 *   view-model tests").
 * - system-id.test.ts: a DOMAIN test dynamically imports
 *   roguetrader/bootstrap/config to pin the load-order fallback.
 * - foundry/ports.test.ts: an INFRASTRUCTURE test imports resolveCritical /
 *   currentRound from roguetrader/rules/criticals — infrastructure may not
 *   depend on rules at all (ALLOWED has no rules for infrastructure).
 */
const EXPECTED_TEST_FILE_VIOLATIONS: readonly string[] = [
	'src/ffg/application/pack-doc-links.test.ts imports "../../roguetrader/rules/advancement" (rules) — application may not depend on rules',
	'src/ffg/domain/system-id.test.ts imports "../../roguetrader/bootstrap/config" (bootstrap) — domain may not depend on bootstrap',
	'src/ffg/domain/system-profile-dark-heresy.test.ts imports "../../roguetrader/rules/advancement" (rules) — domain may not depend on rules',
	'src/roguetrader/infrastructure/foundry/ports.test.ts imports "../../rules/criticals" (rules) — infrastructure may not depend on rules',
];

describe("architecture boundaries (epic kof0)", () => {
	test("every layer only depends inward, and inner layers are Foundry-free", () => {
		// Test files are INCLUDED (bead poq3): a `*.test.ts` was the one place a
		// domain -> application import (mergeModifiers) could hide, and any test
		// file is source the scanner must see. The sibling-id and walk-locality
		// scans below keep the non-test default — see their doc comments.
		const files = LAYER_DIRS.flatMap(([, dir]) => collect(dir, true));
		const violations = files.flatMap((file) =>
			violationsFor(file, readFileSync(file, "utf8")),
		);
		// Pre-existing test-file inversions are PINNED (see the constant above):
		// they are reported debt, not allowed — exactly these four may exist.
		expect(violations.map(violationKey).sort()).toEqual([
			...EXPECTED_TEST_FILE_VIOLATIONS,
		]);
	});

	test("the scanner covers test files (bead poq3)", () => {
		// The regression this bead closed: the domain effect suite imported
		// mergeModifiers from the application funnel and no scan saw it.
		const violations = violationsFor(
			"src/ffg/domain/x.test.ts",
			'import { mergeModifiers } from "../../application/funnel";\n',
		);
		expect(violations.some((v) => v.includes("may not depend on"))).toBe(true);
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

// ---------------------------------------------------------------------------
// Effect-engine walk locality (bead jahb)
// ---------------------------------------------------------------------------

/**
 * The effect kind whose WALK must stay in the engine.
 *
 * `collectCharacteristicDelta` (domain/effects) is the ONE walk that folds
 * "characteristic-modifier" rows into a derived delta; the effective
 * characteristic value, and anything built on it, reads that. A module that
 * re-walks the kind by hand re-plants the bug bead jahb fixed (its walk never
 * read the guard), and open bead xdwt will consolidate the walks — a second
 * hand copy would bake the bug back in.
 *
 * The scan is a cheap grep over the kind's literal in non-test source outside
 * `src/ffg/domain/effects/**`, comments stripped (prose mentions never trip;
 * a hand walk's `effect.kind !== "characteristic-modifier"` does). Files that
 * legitimately name the kind for OTHER purposes (row authoring, drop-time
 * wiring) are allowlisted below; like the sibling allowlist above, the list
 * is pinned and each entry is a documented non-walk use.
 */
const CHARACTERISTIC_WALK_DIR = "src/ffg/domain/effects";

const CHARACTERISTIC_MODIFIER_KIND = /characteristic-modifier/g;

const CHARACTERISTIC_WALK_ALLOWLIST: ReadonlySet<string> = new Set([
	// Authors mutation rows carrying the kind (affliction grant payloads) —
	// data authoring, not a derived-value walk.
	"src/roguetrader/rules/afflictions.ts",
	// Classifies drop-time rows by kind when applying an affliction — reads the
	// row the drop just authored, not a walk over owned effects.
	"src/roguetrader/sheet/actor/affliction-drop.ts",
]);

/**
 * Every place OUTSIDE the effect engine that mentions the kind in code
 * (empty = the walk is local). Comments are stripped so a doc-comment mention
 * of WHY the collector exists never trips.
 */
export function characteristicWalkViolationsFor(
	file: string,
	source: string,
): string[] {
	const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
	if (
		rel.startsWith(`${CHARACTERISTIC_WALK_DIR}/`) ||
		rel === CHARACTERISTIC_WALK_DIR ||
		CHARACTERISTIC_WALK_ALLOWLIST.has(rel)
	) {
		return [];
	}
	const stripped = stripComments(source);
	CHARACTERISTIC_MODIFIER_KIND.lastIndex = 0;
	if (!CHARACTERISTIC_MODIFIER_KIND.test(stripped)) return [];
	return [
		`${rel} touches the "characteristic-modifier" kind outside the effect engine — derive deltas through collectCharacteristicDelta (domain/effects) instead of re-walking the kind; a second walk re-plants the guard bug (bead jahb)`,
	];
}

describe("effect-engine walk locality (bead jahb)", () => {
	test("the characteristic-modifier walk lives only in the effect engine (or the documented allowlist)", () => {
		const violations = collect("src").flatMap((file) =>
			characteristicWalkViolationsFor(file, readFileSync(file, "utf8")),
		);
		expect(violations).toEqual([]);
	});

	test("the allowlist is exactly the two non-walk kind users", () => {
		// A growing allowlist is a second walk growing quietly; keep the list
		// pinned and each entry documented as a non-walk use.
		expect([...CHARACTERISTIC_WALK_ALLOWLIST].sort()).toEqual([
			"src/roguetrader/rules/afflictions.ts",
			"src/roguetrader/sheet/actor/affliction-drop.ts",
		]);
	});

	test("the scanner flags a hand walk outside the effect engine", () => {
		const violations = characteristicWalkViolationsFor(
			"src/roguetrader/data/actor/character.ts",
			'for (const e of effects) { if (e.kind !== "characteristic-modifier") continue; }\n',
		);
		expect(violations.length).toBe(1);
		expect(violations[0]).toContain("outside the effect engine");
	});

	test("the scanner ignores the kind inside domain/effects", () => {
		const violations = characteristicWalkViolationsFor(
			"src/ffg/domain/effects/x.ts",
			'export const KIND = "characteristic-modifier";\n',
		);
		expect(violations).toEqual([]);
	});

	test("the scanner ignores a prose mention in a comment", () => {
		// Documenting WHY the collector exists must not trip the guard.
		const violations = characteristicWalkViolationsFor(
			"src/roguetrader/rules/x.ts",
			"// characteristic-modifier rows fold through the shared collector\nexport const x = 1;\n",
		);
		expect(violations).toEqual([]);
	});

	test("the scanner honours the allowlist", () => {
		const violations = characteristicWalkViolationsFor(
			"src/roguetrader/rules/afflictions.ts",
			'if (effect.kind !== "characteristic-modifier") continue;\n',
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
