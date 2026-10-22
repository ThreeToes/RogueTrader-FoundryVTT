/**
 * Every `{{config "KEY"}}` in a template resolves (epic kof0 follow-up).
 *
 * The production helper (src/roguetrader/sheet/handlebars.ts) resolves a key
 * through CONFIG.ROGUE_TRADER's EntryRegistry instances or, as a fallback,
 * RogueTraderConfig. But the template verifier's stub is `config: () => ({})`
 * (utils/verify-templates.mjs), so a TYPO in a template key renders an empty
 * <select> on every sheet that uses it — with build, lint, verify:templates
 * and the whole test suite all green. Foundry only complains on render.
 *
 * This closes the loop the same way utils/template-refs.test.ts closes the
 * template-path loop, and mirrors the i18n half of
 * utils/template-i18n-resolution.test.ts:
 *
 *  1. Scan every .hbs file under template/ for literal `config "KEY"`
 *  2. Assert each KEY resolves to a real, NON-EMPTY registry/config entry —
 *     a typo resolves to `undefined`, which `selectOptions` renders as
 *     nothing at all.
 *  3. Assert every resolved label is an i18n-shaped key ("A.B"-style) that
 *     exists in lang/en.json. (utils/i18n-key-parity.test.ts covers parity
 *     across the four languages; this only needs en presence per key.)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
	EntryRegistry,
} from "../src/roguetrader/registry";
import { RogueTraderConfig } from "../src/roguetrader/sheet/config";

const TEMPLATE_ROOT = "template";
/** The keys the templates are known to use today — guards the scanner. */
const KNOWN_KEYS = [
	"availability",
	"equipStates",
	"qualities",
	"craftsmanship",
	"battlesuitSystemCategories",
	"protectionTypes",
	"ship-weapon-slots",
];

/** Every .hbs file under template/, recursively. */
function hbsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...hbsFiles(full));
		else if (full.endsWith(".hbs")) out.push(full);
	}
	return out;
}

/** Every literal `config "KEY"` argument, with its source location. */
function referencedConfigKeys(): Array<{ file: string; line: number; key: string }> {
	const found: Array<{ file: string; line: number; key: string }> = [];
	const pattern = /\bconfig\s+"([A-Za-z0-9_-]+)"/g;
	for (const file of hbsFiles(TEMPLATE_ROOT)) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(pattern)) {
			found.push({
				file,
				line: source.slice(0, match.index).split("\n").length,
				key: match[1]!,
			});
		}
	}
	return found;
}

/**
 * The registry set, resolved the way the production helper resolves it
 * (handlebars.ts): registry-backed keys come from the exports of
 * src/roguetrader/registry.ts (the same EntryRegistry instances that
 * init attaches under CONFIG.ROGUE_TRADER), static keys fall through to
 * RogueTraderConfig. Filtered on `instanceof` so future exports cannot
 * accidentally shadow a config key with something that is not a registry.
 */
const rtRegistry = await import("../src/roguetrader/registry");
function resolveConfigKey(key: string): Record<string, string> | undefined {
	const candidate = (rtRegistry as Record<string, unknown>)[key];
	if (candidate instanceof EntryRegistry) return candidate.choices;
	return (RogueTraderConfig as Record<string, unknown>)[key] as
		| Record<string, string>
		| undefined;
}

/** lang/en.json — the flat English dictionary, label key -> text. */
const en = JSON.parse(readFileSync("lang/en.json", "utf8")) as Record<
	string,
	string
>;

describe('template {{config "KEY"}} resolution', () => {
	test("every config key used by a template resolves to a real entry", () => {
		const refs = referencedConfigKeys();
		// Guard the guard: an empty scan would make every later assertion
		// pass vacuously.
		expect(refs.length).toBeGreaterThan(20);
		const used = [...new Set(refs.map(({ key }) => key))].sort();
		const missing = used.filter((key) => {
			const resolved = resolveConfigKey(key);
			return !resolved || Object.keys(resolved).length === 0;
		});
		expect(
			missing,
			`templates use config keys that resolve to nothing: ${missing.join(", ")}`,
		).toEqual([]);
	});

	test("the scanner sees the known vocabulary (not a drifted pattern)", () => {
		const used = new Set(referencedConfigKeys().map(({ key }) => key));
		const unseen = KNOWN_KEYS.filter((key) => !used.has(key));
		expect(
			unseen,
			`known template config keys the scanner stopped finding: ${unseen.join(", ")}`,
		).toEqual([]);
	});

	test("every resolved label is an i18n key present in lang/en.json", () => {
		const refs = referencedConfigKeys();
		// Same message shape as the missing-keys filter above, so a key that
		// resolves to nothing fails here with a self-explanatory diff instead of
		// dying on the non-null assertion below ("Cannot convert undefined").
		const unresolved = [...new Set(refs.map(({ key }) => key))].filter(
			(key) =>
				!resolveConfigKey(key) || Object.keys(resolveConfigKey(key)!).length === 0,
		);
		expect(
			unresolved,
			`templates use config keys that resolve to nothing: ${unresolved.join(", ")}`,
		).toEqual([]);
		const failures: string[] = [];
		for (const { file, line, key } of refs) {
			const resolved = resolveConfigKey(key)!;
			for (const [value, label] of Object.entries(resolved)) {
				if (typeof label !== "string" || !label.includes(".")) {
					failures.push(`${file}:${line} config "${key}" -> ${value}: label is not an i18n key`);
				} else if (en[label] === undefined) {
					failures.push(`${file}:${line} config "${key}" -> ${value}: missing lang/en.json key ${label}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});