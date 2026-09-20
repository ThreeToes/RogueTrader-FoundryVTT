/**
 * No internal bead ids in shipped text (epic kof0 follow-up, bead x9yu).
 *
 * Bead ids are development bookkeeping. They belong in code comments, YAML
 * comments and Handlebars comments, where the next maintainer benefits from
 * them; they must never reach a player, a GM, a journal page or a chat card.
 * The owner found one rendered on the Gear sheet ("…through the rules engine
 * (bead fjw/yb6)"), which is what prompted this guard.
 *
 * HOW IT AVOIDS FALSE POSITIVES: it parses the JSON/YAML and walks the STRING
 * VALUES, so comments are excluded by construction rather than by grep. That
 * matters twice over —
 *   - a grep would flag the ~140 YAML comments and ~26 Handlebars comments that
 *     are SUPPOSED to keep their ids;
 *   - a grep would also flag real 40k content: "Micro-bead", "vox-bead" and
 *     "beady eyes" are legitimate words, not ids. The pattern below requires
 *     the id FORM (the word, a space, then a short alphanumeric token).
 *
 * The pack half is machine-local (src/packs is its own repo and CI has no
 * clone), so it follows the skipIf pattern used by rules/origins.test.ts: the
 * language half always runs, the pack half runs locally.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { parseAllDocuments } from "yaml";

/**
 * "bead xfta", "beads fjw/yb6", "bead 5lbn's scope" — the id form only.
 *
 * The token is captured so a legitimate word can be excused below: real 40k
 * content contains "bead <word>" too ("an integral micro-bead vox, mag-boots,
 * lamp pack"), and a naive grep flags it. Matching the id FORM plus a small
 * allowlist is what keeps this guard honest rather than noisy.
 */
const BEAD_ID = /beads? ([a-z0-9]{3,6})\b/i;

/**
 * Real content that reads like an id. `micro-bead vox` is a comms device.
 * Anything added here needs a reason — it is the guard's only blind spot.
 */
const REAL_CONTENT_WORDS = new Set(["vox"]);

/** Does this string reference a bead id (as opposed to the word "bead")? */
function hasBeadId(text: string): boolean {
	const match = BEAD_ID.exec(text);
	return match !== null && !REAL_CONTENT_WORDS.has(match[1].toLowerCase());
}

/** Every string value in a parsed JSON/YAML structure, with its path. */
function stringValues(
	value: unknown,
	trail: string[] = [],
): Array<{ where: string; text: string }> {
	if (typeof value === "string") return [{ where: trail.join("."), text: value }];
	if (Array.isArray(value)) {
		return value.flatMap((item, i) => stringValues(item, [...trail, String(i)]));
	}
	if (value && typeof value === "object") {
		return Object.entries(value).flatMap(([key, item]) =>
			stringValues(item, [...trail, key]),
		);
	}
	return [];
}

function langOffenders(): string[] {
	const bad: string[] = [];
	for (const lang of ["en", "es", "fr", "pl"]) {
		const file = `lang/${lang}.json`;
		const dict = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		for (const { where, text } of stringValues(dict)) {
			if (hasBeadId(text)) bad.push(`${file} ${where}: ${text}`);
		}
	}
	return bad;
}

const PACK_ROOT = "src/packs/rogue_trader";
const HAS_PACKS = existsSync(PACK_ROOT);

function yamlFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...yamlFiles(full));
		else if (full.endsWith(".yaml")) out.push(full);
	}
	return out;
}

function packOffenders(): string[] {
	const bad: string[] = [];
	for (const file of yamlFiles(PACK_ROOT)) {
		// Compendium files are multi-document (`---` separated), so parse all of
		// them; a single `parse` throws on the second document.
		const docs = parseAllDocuments(readFileSync(file, "utf8")).map((doc) =>
			doc.toJS({ maxAliasCount: -1 }),
		) as unknown[];
		for (const { where, text } of stringValues(docs)) {
			if (hasBeadId(text)) bad.push(`${file} ${where}: ${text.slice(0, 120)}`);
		}
	}
	return bad;
}

describe("shipped text carries no bead ids (bead x9yu)", () => {
	test("no language string contains a bead id", () => {
		expect(langOffenders()).toEqual([]);
	});

	test("the guard recognises the id form and ignores the real word", () => {
		// Guard the guard: a pattern that matched nothing would pass vacuously.
		expect(hasBeadId("applied by the rules engine (bead fjw/yb6)")).toBe(true);
		expect(hasBeadId("is bead g0vv's scope")).toBe(true);
		expect(hasBeadId("the xebec is bead 5lbn's scope")).toBe(true);
		// Real 40k content that a naive grep would flag.
		expect(hasBeadId("- name: Micro-bead")).toBe(false);
		expect(hasBeadId("Internal vox-bead")).toBe(false);
		expect(hasBeadId("far too many beady eyes")).toBe(false);
		expect(
			hasBeadId("An integral micro-bead vox, mag-boots, lamp pack"),
		).toBe(false);
	});

	test.skipIf(!HAS_PACKS)(
		"no compendium string contains a bead id",
		() => {
			expect(packOffenders()).toEqual([]);
		},
	);
});
