/**
 * Repo-wide i18n key parity guard (bead qgtz). Two invariants over the four
 * language files (lang/en|es|fr|pl.json are FLAT: one key = one translation):
 *
 * 1. Parity — all four files must carry the IDENTICAL key set. Historically
 *    they drifted: en was missing SOURCE.FROM_POWERS (English chat-card
 *    labels fell back to the literal key string) and files carried dead keys
 *    only in some languages. Symmetric edits keep this green; a key added or
 *    deleted in a subset of files fails here with file + key named.
 *
 * 2. Static references — every i18n key referenced by a string literal in
 *    code or template exists in lang/en.json (and, via parity, in all four).
 *    Scans: `{{localize "KEY"}}` in template HBS files, and
 *    localize("KEY") / format("KEY") / t("KEY") calls in src files (test
 *    files excluded: they assert ON keys rather than render them).
 *    Keys composed at runtime are invisible to the scan; those live in
 *    DYNAMIC_KEY_FAMILIES below with a pointer to their composing site, and
 *    the guard still pins their translated presence in all four files.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LANGS = ["en", "es", "fr", "pl"] as const;
type Dict = Record<string, string>;

const dictionaries = Object.fromEntries(
	LANGS.map((lang) => [
		lang,
		JSON.parse(readFileSync(`lang/${lang}.json`, "utf8")) as Dict,
	]),
) as Record<(typeof LANGS)[number], Dict>;

/** Recursively list files with the given extension below `dir` (relative). */
function listFiles(dir: string, ext: string): string[] {
	const out: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(ext)) out.push(path);
		}
	};
	walk(dir);
	return out;
}

/** Key-shaped identifiers only: UPPER_SNAKE segments joined with dots. */
const KEY_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+$/;

describe("i18n key parity (bead qgtz)", () => {
	test("the four language files carry the IDENTICAL key set", () => {
		const enKeys = new Set(Object.keys(dictionaries.en));
		for (const lang of LANGS.slice(1)) {
			const keys = new Set(Object.keys(dictionaries[lang]));
			const missing = [...enKeys].filter((key) => !keys.has(key)).sort();
			const extra = [...keys].filter((key) => !enKeys.has(key)).sort();
			const report = [
				...missing.map((key) => `${lang}.json missing: ${key}`),
				...extra.map((key) => `${lang}.json extra: ${key}`),
			];
			expect(report, report.join("; ")).toEqual([]);
		}
	});

	test("the parity scan sees a meaningful corpus (stays meaningful)", () => {
		expect(listFiles("template", ".hbs").length).toBeGreaterThan(30);
		expect(
			listFiles("src", ".ts").filter((file) => !file.includes(".test.ts"))
				.length,
		).toBeGreaterThan(100);
	});

	test("every statically-referenced key exists in lang/en.json", () => {
		const staticRefs = new Set<string>();
		for (const file of listFiles("template", ".hbs")) {
			const source = readFileSync(file, "utf8");
			// {{localize "KEY"}} (also as a subexpression: (localize "KEY")).
			for (const match of source.matchAll(
				/\blocalize\s+"([A-Z][A-Z0-9_.]+)"/g,
			)) {
				staticRefs.add(match[1]!);
			}
		}
		for (const file of listFiles("src", ".ts").filter(
			(file) => !file.includes(".test.ts"),
		)) {
			const source = readFileSync(file, "utf8");
			// localize("KEY") / format("KEY") / *.t("KEY") in code — game.i18n,
			// ports.i18n and the injected-pure-function variants all use these
			// method names with a string-literal key.
			for (const match of source.matchAll(
				/(?:\blocalize|\bformat|\bt)\(\s*"([A-Z][A-Z0-9_.]+)"/g,
			)) {
				staticRefs.add(match[1]!);
			}
		}
		// Sanity-pin the scan so it cannot silently degrade to an empty set.
		expect(staticRefs.size).toBeGreaterThan(100);
		expect(staticRefs).toContain("ADVANCE.BUY");

		const missing = [...staticRefs]
			.filter((key) => !KEY_SHAPE.test(key) || dictionaries.en[key] === undefined)
			.sort();
		expect(
			missing,
			`lang/en.json is missing statically-referenced keys: ${missing.join(", ")}`,
		).toEqual([]);
	});

	/**
	 * Key families invisible to the static literal scan — either genuinely
	 * composed at runtime (template-literal prefixes) or stored as a literal
	 * in a constant/table and localized at another site. Each entry pins that
	 * every en.json key in the family is translated in ALL FOUR files, so a
	 * family cannot quietly gain a key (or lose one) out of parity. Sites
	 * point at the composition table for maintenance.
	 */
	const DYNAMIC_KEY_FAMILIES: Array<{ prefix: string; sites: string[] }> = [
		{
			// `CHARACTERISTIC.${key.toUpperCase()}` short forms and the
			// CHARACTERISTIC.WEAPON_SKILL-style long forms.
			prefix: "CHARACTERISTIC.",
			sites: [
				"src/roguetrader/sheet/actor/advancement-view-model.ts:344",
				"src/roguetrader/sheet/item/career-sheet.ts:127",
				"src/roguetrader/sheet/actor/advancement-dialog.ts:557",
				"src/roguetrader/presentation/rolls/characteristic-skill.ts:31",
				"src/roguetrader/registry.ts:54 (CHARACTERISTIC_LONG_LABELS → sheet/item/effect-actions.ts:94)",
				"src/rules-engine/profile.ts:113 (labelPrefix)",
			],
		},
		{
			// `ADVANCE.TIER_${next.tier.toUpperCase()}` over rules/advancement.ts
			// SCHEME_TIERS (simple/intermediate/traineed/expert).
			prefix: "ADVANCE.TIER_",
			sites: ["src/roguetrader/sheet/actor/advancement-view-model.ts:348"],
		},
		{
			// Choice map literals, localized downstream by the sheet.
			prefix: "ADVANCE.TYPE_",
			sites: ["src/roguetrader/data/actor/character.ts:338"],
		},
		{
			// LADDER_OPTIONS label literals, localized by the skill sheet dialog.
			prefix: "SKILL.LADDER_",
			sites: ["src/roguetrader/sheet/skills-domain.ts:20"],
		},
		{
			// `SHIP_COMBAT.STATE_${state.toUpperCase()}` and
			// `SHIP_COMBAT.${kind.toUpperCase()}`.
			prefix: "SHIP_COMBAT.",
			sites: [
				"src/roguetrader/sheet/actor/ship-sheet.ts:36",
				"src/roguetrader/presentation/rolls/ship.ts:87",
			],
		},
		{
			// `STARSHIP.CREW_${key.toUpperCase()}` /
			// `STARSHIP.SLOT_${key.toUpperCase()}`.
			prefix: "STARSHIP.",
			sites: [
				"src/roguetrader/sheet/actor/ship-sheet.ts:149,221,272",
				"src/roguetrader/sheet/actor/ship-creator.ts:247",
			],
		},
		{
			// EFFECT_KIND_LABEL_KEYS kind → label table.
			prefix: "EFFECT_KIND.",
			sites: ["src/roguetrader/sheet/item/effect-actions.ts:53"],
		},
		{
			// WARRANT_ROW_LABEL_KEYS row → label table.
			prefix: "WARRANT.ROW_",
			sites: ["src/roguetrader/rules/warrant.ts:44"],
		},
		{
			// GROUP_ORDER Foundry core item-type labels.
			prefix: "TYPES.Item.",
			sites: ["src/roguetrader/sheet/npc-inventory.ts:56"],
		},
	];

	test("dynamic key families are translated in all four language files", () => {
		for (const { prefix, sites } of DYNAMIC_KEY_FAMILIES) {
			const familyKeys = Object.keys(dictionaries.en)
				.filter((key) => key.startsWith(prefix))
				.sort();
			expect(
				familyKeys.length,
				`family ${prefix} (sites: ${sites.join(", ")}) is empty in en.json`,
			).toBeGreaterThan(0);
			for (const lang of LANGS.slice(1)) {
				const missing = familyKeys.filter((key) =>
					["", undefined].includes(dictionaries[lang][key]),
				);
				expect(
					missing,
					`${lang}.json is missing ${prefix} family keys (sites: ${sites.join(", ")}): ${missing.join(", ")}`,
				).toEqual([]);
			}
		}
	});
});