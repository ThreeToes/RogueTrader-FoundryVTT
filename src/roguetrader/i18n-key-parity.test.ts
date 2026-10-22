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
 *    localize("KEY") / format("KEY") / t("KEY") calls in src files, and the
 *    notify announcement port's info/warn/error("KEY") calls (bead 78tb:
 *    src/ffg/infrastructure/foundry/ports.ts localises those, so their keys
 *    are real references — the scan originally skipped them, which hid the
 *    missing ROLL.LAUNCHER_UNLOADED key).  (test
 *    files excluded: they assert ON keys rather than render them).
 *    Keys composed at runtime are invisible to the scan; those live in
 *    DYNAMIC_KEY_FAMILIES below with a pointer to their composing site, and
 *    the guard still pins their translated presence in all four files.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHARACTERISTIC_KEYS } from "../ffg/domain/model/taxonomy";
// The turn-flag vocabulary the runtime composes i18n keys from (bead c7jo:
// the torpedo-run chip gap this test pins).
import { SHIP_TURN_FLAG_KEYS } from "../rules-engine/ship-turn-state";
// Bead iktx: the characteristic composition seam + the key vocabulary it
// composes over — the parity guard pins every characteristic key's label
// key in all four language files.
import { characteristicLabelKey } from "./rules/labels";
// The ship-action GROUP LABEL map (bead t2bj): the four group h3 labels
// localize through this table, so a group key added without translations
// renders RAW in the tab — the parity guard pins the map instead
// (ship-combat-view.ts's SHIP_ACTION_GROUP_KEYS dispatch).
import { SHIP_ACTION_GROUP_KEYS } from "./sheet/actor/ship-combat-view";

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

	test("no key is a dotted prefix of another key (Foundry expandObject constraint)", () => {
		// Foundry's Localization loads every language file through
		// foundry.utils.expandObject, which THROWS when one flat key is a
		// dotted prefix of another (a label leaf "RULES.X" plus a child
		// "RULES.X.HINT"), and its catch swallows the error — the whole
		// package dictionary is dropped and every sheet renders raw keys
		// (the 2026-10 knob-i18n regression). Keep every pair two leaves:
		// "RULES.X" + "RULES.X_HINT". This is the runtime contract
		// expandObject enforces, checked here where JSON.parse cannot see it.
		for (const lang of LANGS) {
			const keys = Object.keys(dictionaries[lang]).sort();
			const collisions: string[] = [];
			for (let i = 0; i < keys.length; i++) {
				for (let j = i + 1; j < keys.length; j++) {
					if (keys[j].startsWith(`${keys[i]}.`)) {
						collisions.push(`${keys[i]} <-> ${keys[j]}`);
					}
				}
			}
			expect(
				collisions,
				`${lang}.json carries expandObject-prefix collisions:`,
			).toEqual([]);
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
			// method names with a string-literal key. notify.info/warn/error(
			// "KEY") are collected too: the notify port localises its key
			// argument (bead 78tb).
			for (const match of source.matchAll(
				/(?:\blocalize|\bformat|\bt)\(\s*"([A-Z][A-Z0-9_.]+)"/g,
			)) {
				staticRefs.add(match[1]!);
			}
			for (const match of source.matchAll(
				/\bnotify\.(?:info|warn|error)\(\s*"([A-Z][A-Z0-9_.]+)"/g,
			)) {
				staticRefs.add(match[1]!);
			}
		}
		// Sanity-pin the scan so it cannot silently degrade to an empty set.
		expect(staticRefs.size).toBeGreaterThan(100);
		expect(staticRefs).toContain("ADVANCE.BUY");
		// Sanity-pin the notify extension (bead 78tb): adapter.ts warns with
		// ROLL.LAUNCHER_UNLOADED — a notify.* key invisible to the original
		// localize/format/t scan, which is exactly the shape this extension
		// exists to catch.
		expect(staticRefs).toContain("ROLL.LAUNCHER_UNLOADED");

		const missing = [...staticRefs]
			.filter(
				(key) => !KEY_SHAPE.test(key) || dictionaries.en[key] === undefined,
			)
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
			// characteristicLabelKey(key) (bead iktx) — the ONE composition seam
			// for the short `CHARACTERISTIC.${key.toUpperCase()}` form; every
			// sheet/presentation site imports it from rules/labels.ts. The
			// CHARACTERISTIC.WEAPON_SKILL-style long forms stay a separate
			// registry (registry.ts) — short and long translate differently in
			// es/fr/pl.
			prefix: "CHARACTERISTIC.",
			sites: [
				"src/roguetrader/rules/labels.ts (characteristicLabelKey)",
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
				// bead 7gcm: `SHIP_COMBAT.STAT_${stat.toUpperCase()}` (the
				// ship-action test labels) and
				// `SHIP_COMBAT.TURN_FLAG_${key.toUpperCase()}_CHIP` (the
				// combat-tab flag chips; bead c7jo adds the torpedo-run chip,
				// composed the same way for the live BFK salvo (ship-sheet.ts:493).
				"src/roguetrader/sheet/actor/ship-sheet.ts:667,742",
				// bead 7gcm/c7jo: the salvo turn-flag rows compose
				// `SHIP_COMBAT.TURN_FLAG_${key.toUpperCase()}_OWN` / `_TARGET`
				// (and the torpedo-run live-salvo flag surfaces as a chip).
				"src/roguetrader/presentation/rolls/ship.ts:87",
				"src/roguetrader/presentation/rolls/ship.ts:158,161",
			],
		},
		{
			// `SHIP_ORDNANCE.PICK_${what.toUpperCase()}` (the
			// tube/torpedo/salvo pick dialogs) and
			// `SHIP_ORDNANCE.GUIDANCE_${name.toUpperCase().replaceAll("-", "_")}`
			// (the guidance buttons, rules-engine/ship-ordnance.ts's
			// TORPEDO_GUIDANCES keys) — bead a413.
			prefix: "SHIP_ORDNANCE.PICK_",
			sites: [
				"src/roguetrader/presentation/rolls/ship-ordnance.ts (promptPick)",
			],
		},
		{
			prefix: "SHIP_ORDNANCE.GUIDANCE_",
			sites: [
				"src/roguetrader/presentation/rolls/ship-ordnance.ts (guidance buttons)",
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
			// EffectSpec.labelKey values (bead ypbx: moved from the deleted
			// EFFECT_KIND_LABEL_KEYS table into the spec registrations).
			prefix: "EFFECT_KIND.",
			sites: ["src/ffg/domain/effects/specs.ts (EffectSpec.labelKey)"],
		},
		{
			// Rule-knob labels + hints: every RULES.* key is COMPOSED in the
			// registry (labelKeyFor/hintKeyFor) or derived beside it (group,
			// option and hazard labels) — none of them is a string literal in a
			// template, so the static scan cannot see them. Bead wxut.4.
			//
			// ONE family serves BOTH registries: labelKeyFor() derives a single
			// flat RULES. namespace, so Dark Heresy 2e's keys (epic w9sa, child
			// D3) land here too. Three of DH2's keys deliberately REUSE RT's
			// (test.critOnDouble, damage.primitiveArmourDouble,
			// damage.righteousFury) — the wording stays true for both systems — and
			// the rest are DH2's own. The reuse set is pinned by
			// src/ffg/domain/rule-knobs-dark-heresy.test.ts.
			prefix: "RULES.",
			sites: [
				"src/ffg/domain/rule-knobs.ts (labelKeyFor/hintKeyFor)",
				"src/ffg/domain/rule-knobs-dark-heresy.ts (DARK_HERESY_RULE_KNOBS)",
				"src/roguetrader/presentation/rules-view-model.ts (groupLabelKey/optionLabelKey/hazardKeyFor)",
			],
		},
		{
			// WARRANT_ROW_LABEL_KEYS row → label table.
			prefix: "WARRANT.ROW_",
			sites: ["src/roguetrader/rules/warrant.ts:44"],
		},
		{
			// shipCritical(criticalRoll) → SHIP_CRITICALS.<key> for the salvo
			// chat card (bead 26jm).
			prefix: "SHIP_CRITICALS.",
			sites: ["src/roguetrader/presentation/rolls/ship.ts (postShipSalvoCard)"],
		},
		{
			// bodyLocationLabelKey(location) → BODY_LOCATION.LEFT_ARM over the
			// kebab-case location slugs (critical cards + NPC armour panel).
			prefix: "BODY_LOCATION.",
			sites: ["src/roguetrader/rules/labels.ts:20 (bodyLocationLabelKey)"],
		},
		{
			// `DAMAGE_TYPE.${value.toUpperCase()}` (and the *_SHORT single-letter
			// variants) — the damageTypes registry seed + adapter.ts's damage-card
			// short label (bead seeg).
			prefix: "DAMAGE_TYPE.",
			sites: [
				"src/roguetrader/registry.ts (DAMAGE_TYPES seed)",
				"src/roguetrader/rules/adapter.ts:306",
			],
		},
		{
			// weapon qualityLabelKey(quality) → QUALITY.GYRO_STABILISED over the
			// kebab/camel quality slugs — the funnel emits the KEY, display
			// seams localize (bead dfdv).
			prefix: "QUALITY.",
			sites: ["src/ffg/application/funnel.ts (qualityLabelKey)"],
		},
		{
			// GROUP_ORDER Foundry core item-type labels.
			prefix: "TYPES.Item.",
			sites: ["src/roguetrader/sheet/npc-inventory.ts:56"],
		},
	];

	// Bead iktx: the label keys characteristicLabelKey() composes are real
	// references (the static literal scan cannot see them), so pin that EVERY
	// characteristic key's label key resolves in all four language files.
	test("every characteristic key's label key exists in all four languages (bead iktx)", () => {
		for (const key of CHARACTERISTIC_KEYS) {
			const labelKey = characteristicLabelKey(key);
			expect(labelKey).toBe(`CHARACTERISTIC.${key.toUpperCase()}`);
			for (const lang of LANGS) {
				expect(
					dictionaries[lang][labelKey],
					`${lang}.json is missing ${labelKey} (bead iktx: characteristic "${key}")`,
				).toBeTruthy();
			}
		}
	});

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

	/** Untrained i18n strings (bead 1zaa) must never hardcode a profile-data
	 *  value: the untrained penalty is rule-profile data (currently half the
	 *  governing Characteristic), so the wording stays model-neutral. */
	const UNTRAINED_KEYS = [
		"ROLL.UNTRAINED",
		"SKILL.UNTRAINED_HINT",
		"SKILL.UNTRAINED_NOTE",
	];

	/** The turn-flag surfaces S8/S9 compose at runtime (bead c7jo): the
	 *  Combat tab renders a CHIP for EVERY ShipTurnFlagKey (the BFK
	 *  torpedo-run flag included — it lives in plain turnFlags), and the
	 *  salvo kernel's salvoTurnFlagRows emits _OWN/_TARGET rows for the
	 *  firing-side flags (evasive, lock-on-target named to the weapon,
	 *  come-to-new-heading) plus the target's evasive. BACKS_INTO_IT rides
	 *  the same key family through the ship-repair path and the BS salvo
	 *  pipeline (bead wp6o: the firefighting pick deliberately renders a
	 *  manual note instead of this flag). These keys are invisible to the
	 *  static literal scan, so each is pinned here. */
	const TURN_FLAG_ROW_SUFFIXES = [
		"EVASIVE",
		"LOCK_ON_TARGET",
		"COME_TO_NEW_HEADING_BS_PENALTY",
		"BACKS_INTO_IT",
	];

	test("every turn-flag chip and salvo flag row is translated in all four language files (bead c7jo)", () => {
		for (const key of SHIP_TURN_FLAG_KEYS) {
			// The chip composes with hyphens normalised to underscores (bead
			// c7jo: ship.ts's OWN/TARGET rows already do this on the salvo side).
			const upper = key.replaceAll("-", "_").toUpperCase();
			for (const lang of LANGS) {
				expect(
					dictionaries[lang][`SHIP_COMBAT.TURN_FLAG_${upper}_CHIP`] ?? "",
					`${lang}.json missing SHIP_COMBAT.TURN_FLAG_${upper}_CHIP`,
				).not.toBe("");
			}
		}
		for (const key of TURN_FLAG_ROW_SUFFIXES) {
			for (const lang of LANGS) {
				expect(
					dictionaries[lang][`SHIP_COMBAT.TURN_FLAG_${key}_OWN`] ?? "",
					`${lang}.json missing SHIP_COMBAT.TURN_FLAG_${key}_OWN`,
				).not.toBe("");
			}
		}
		for (const lang of LANGS) {
			expect(
				dictionaries[lang]["SHIP_COMBAT.TURN_FLAG_EVASIVE_TARGET"] ?? "",
				`${lang}.json missing SHIP_COMBAT.TURN_FLAG_EVASIVE_TARGET`,
			).not.toBe("");
		}
	});

	/** The ship-action group h3 labels (bead t2bj) — the SHIP_ACTION_GROUP_KEYS
	 *  dispatch map in ship-combat-view.ts is the composition site; every
	 *  entry must resolve in ALL FOUR files (ORdnance was missing from the
	 *  lot and rendered raw as a group heading before this guard). */
	test("the SHIP_ACTION_GROUP_KEYS group labels resolve in all four language files (bead t2bj)", () => {
		expect(Object.values(SHIP_ACTION_GROUP_KEYS)).toContain(
			"SHIP_COMBAT.ACTION_GROUP_ORDNANCE",
		);
		for (const labelKey of Object.values(SHIP_ACTION_GROUP_KEYS)) {
			for (const lang of LANGS) {
				expect(
					dictionaries[lang][labelKey] ?? "",
					`${lang}.json missing ship-action group label ${labelKey}`,
				).not.toMatch(/^\s*$/);
			}
		}
	});

	test("untrained i18n strings never hardcode the -10 penalty (bead 1zaa)", () => {
		for (const lang of LANGS) {
			for (const key of UNTRAINED_KEYS) {
				expect(
					dictionaries[lang][key] ?? "",
					`${lang}.json ${key} hardcodes "-10" — the untrained penalty is profile data, keep the wording model-neutral`,
				).not.toMatch(/[-−]\s*10/);
			}
		}
	});
});
