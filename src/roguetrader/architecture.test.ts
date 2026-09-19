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
 *   bootstrap      -> everything + Foundry (the composition root)
 *
 * Layers that do not exist yet are simply not scanned, so this test is green
 * from day one and tightens automatically as the new directories appear.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

type Layer =
	| "kernel"
	| "domain"
	| "application"
	| "infrastructure"
	| "presentation"
	| "bootstrap"
	| "other";

/** Directory -> layer. Order matters: first match wins. */
const LAYER_DIRS: ReadonlyArray<readonly [Layer, string]> = [
	["kernel", "src/rules-engine/src"],
	["domain", "src/roguetrader/domain"],
	["application", "src/roguetrader/application"],
	["infrastructure", "src/roguetrader/infrastructure"],
	["presentation", "src/roguetrader/presentation"],
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
		"other",
	],
	bootstrap: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"bootstrap",
		"other",
	],
	other: [
		"kernel",
		"domain",
		"application",
		"infrastructure",
		"presentation",
		"bootstrap",
		"other",
	],
};

/** Layers that must stay Foundry-free and self-contained. */
const INNER: readonly Layer[] = ["kernel", "domain", "application"];

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
 * Blank out comments and string bodies so global detection cannot be fooled by
 * prose or string literals, while preserving newlines for line numbers.
 */
function stripCommentsAndStrings(source: string): string {
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
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
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
					out += "  ";
					i += 2;
					continue;
				}
				out += source[i] === "\n" ? "\n" : " ";
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

	if (INNER.includes(layer)) {
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
			"src/roguetrader/domain/x.ts",
			'import type { Actor } from "fvtt-types/documents";\n',
		);
		expect(violations.length).toBeGreaterThan(0);
	});

	test("the scanner flags a Foundry global in the kernel", () => {
		const violations = violationsFor(
			"src/rules-engine/src/x.ts",
			'export const name = game.i18n.localize("X");\n',
		);
		expect(violations.some((v) => v.includes("Foundry global"))).toBe(true);
	});

	test("the scanner ignores Foundry words in comments and strings", () => {
		const violations = violationsFor(
			"src/rules-engine/src/x.ts",
			'// uses game.i18n at the edge\nexport const label = "game.i18n";\n',
		);
		expect(violations).toEqual([]);
	});

	test("the scanner flags domain importing application", () => {
		const violations = violationsFor(
			"src/roguetrader/domain/x.ts",
			'import { performRoll } from "../application/rolls";\n',
		);
		expect(violations.some((v) => v.includes("may not depend on"))).toBe(true);
	});

	test("the scanner allows an inward kernel import", () => {
		const violations = violationsFor(
			"src/rules-engine/src/damage.ts",
			'import type { RuleProfile } from "./profile";\n',
		);
		expect(violations).toEqual([]);
	});

	test("the scanner allows infrastructure to use Foundry", () => {
		const violations = violationsFor(
			"src/roguetrader/infrastructure/foundry/dice.ts",
			'import type { Actor } from "fvtt-types/documents";\nexport const r = new foundry.dice.Roll("1d100");\n',
		);
		expect(violations).toEqual([]);
	});
});
