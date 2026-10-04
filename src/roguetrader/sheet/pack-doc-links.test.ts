/**
 * Unit tests for the shared pack-doc link library (epic 61pk, bead n2b2).
 * The resolver tests here MOVED verbatim from advancement-view-model.test.ts
 * — they are the parity spec for the behaviour-preserving extraction: key
 * first, name-fallback per the documented matching policy (talents
 * case-insensitive, skills exact), empty-guards, unresolvable → ""/null.
 * Plus the library additions: docLinkUuid's type-scoping, packDocAnchor's
 * anchor payload, and the adoption guard that the advancement consumers
 * import from the library (no local copies may return).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	docLinkUuid,
	packDocAnchor,
	resolveSkillDoc,
	resolveTalentDoc,
	OPEN_PACK_DOC_ACTION,
	type PackDocLike,
} from "./pack-doc-links";
import type { AdvanceRowLike } from "../rules/advancement";

/** Row builder, verbatim from the advancement view-model tests (the spec). */
const row = (over: Partial<AdvanceRowLike> = {}): AdvanceRowLike => ({
	key: "",
	name: "",
	type: "skill",
	cost: 100,
	multiplier: 1,
	prerequisites: [],
	rank: 1,
	...over,
});

const LINKED_SKILL_DOCS: PackDocLike[] = [
	{ key: "awareness", name: "Awareness", uuid: "Compendium.rogue-trader.character-options.Item.awarenessId" },
	{ key: "tech-use", name: "Tech-Use", uuid: "Compendium.rogue-trader.character-options.Item.techUseId" },
];

const LINKED_TALENT_DOCS: PackDocLike[] = [
	{
		key: "furious-charge",
		name: "Furious Charge",
		uuid: "Compendium.rogue-trader.character-options.Item.furiousChargeId",
	},
];

describe("pack-doc links — the shared resolvers (moved parity spec, bead n2b2)", () => {
	test("resolveTalentDoc: key first, then case-insensitive name; empty name matches nothing (mirrored guard)", () => {
		expect(
			resolveTalentDoc(row({ key: "furious-charge" }), LINKED_TALENT_DOCS),
		).toBe(LINKED_TALENT_DOCS[0]);
		expect(
			resolveTalentDoc(
				row({ key: "", name: "furious charge" }),
				LINKED_TALENT_DOCS,
			),
		).toBe(LINKED_TALENT_DOCS[0]);
		expect(resolveTalentDoc(row(), LINKED_TALENT_DOCS)).toBeUndefined();
	});

	test("resolveSkillDoc: key first, then exact name; empty key/name match nothing (mirrored guard)", () => {
		expect(
			resolveSkillDoc(row({ key: "tech-use" }), LINKED_SKILL_DOCS),
		).toBe(LINKED_SKILL_DOCS[1]);
		expect(
			resolveSkillDoc(
				row({ key: "", name: "Tech-Use" }),
				LINKED_SKILL_DOCS,
			),
		).toBe(LINKED_SKILL_DOCS[1]);
		expect(
			resolveSkillDoc(row({ key: "", name: "tech-use" }), LINKED_SKILL_DOCS),
		).toBeUndefined(); // exact match only — case differences miss, grant parity
		expect(resolveSkillDoc(row(), LINKED_SKILL_DOCS)).toBeUndefined();
	});

	test("docs without a uuid (plain {key, name} fixtures) resolve, uuid reads ''", () => {
		// uuid is an additive OPTIONAL input: plain {key, name} catalogs keep
		// working — the anchor needs a boolean-testable string, though.
		const docs: PackDocLike[] = [{ key: "awareness", name: "Awareness" }];
		const resolved = resolveSkillDoc(row({ key: "awareness" }), docs);
		expect(resolved?.uuid ?? "").toBe("");
	});
});

describe("pack-doc links — docLinkUuid (type-scoped uuid stamp, bead ha1y)", () => {
	test("talent rows stamp the talent doc's uuid (key, then case-insensitive name)", () => {
		expect(
			docLinkUuid(
				row({ key: "furious-charge", type: "talent" }),
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBe("Compendium.rogue-trader.character-options.Item.furiousChargeId");
		expect(
			docLinkUuid(
				{ key: "", name: "furious charge", type: "talent" },
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBe("Compendium.rogue-trader.character-options.Item.furiousChargeId");
	});

	test("skill rows stamp the skill doc's uuid (key, then exact name)", () => {
		expect(
			docLinkUuid(row({ key: "tech-use" }), LINKED_SKILL_DOCS, LINKED_TALENT_DOCS),
		).toBe("Compendium.rogue-trader.character-options.Item.techUseId");
		expect(
			docLinkUuid(
				{ key: "", name: "Tech-Use" },
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBe("Compendium.rogue-trader.character-options.Item.techUseId");
	});

	test("rows without a type take the skill branch (chat-card names, creator chips)", () => {
		expect(
			docLinkUuid({ key: "", name: "Tech-Use" }, LINKED_SKILL_DOCS, LINKED_TALENT_DOCS),
		).toBe("Compendium.rogue-trader.character-options.Item.techUseId");
	});

	test("unresolvable rows resolve to EMPTY, never undefined (template boolean test)", () => {
		//psy-rating: key with no catalog doc; parameterised: name never matches.
		expect(
			docLinkUuid(
				row({ key: "psy-rating", type: "talent" }),
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBe("");
		expect(
			docLinkUuid(
				row({ key: "", name: "Peer (choose one)", type: "talent" }),
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBe("");
	});
});

describe("pack-doc links — packDocAnchor (the one-helper-call adoption surface)", () => {
	test("resolved rows get an anchor-ready {action, uuid, name}", () => {
		expect(
			packDocAnchor(
				row({ key: "furious-charge", type: "talent", name: "Furious Charge" }),
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toEqual({
			action: "openPackDoc",
			uuid: "Compendium.rogue-trader.character-options.Item.furiousChargeId",
			name: "Furious Charge",
		});
	});

	test("the anchor action is the documented data-action convention", () => {
		expect(OPEN_PACK_DOC_ACTION).toBe("openPackDoc");
		expect(
			packDocAnchor(row({ key: "awareness" }), LINKED_SKILL_DOCS, LINKED_TALENT_DOCS)
				?.action,
		).toBe("openPackDoc");
	});

	test("a display name override flows through (key-only rows)", () => {
		// Creator chips resolve display names from their own name maps; the
		// anchor takes the resolved name as an optional last input.
		expect(
			packDocAnchor(
				{ key: "furious-charge", name: "", type: "talent" },
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
				"Furious Charge",
			)?.name,
		).toBe("Furious Charge");
	});

	test("unresolvable rows return null — the plain-text degradation (never an error)", () => {
		expect(
			packDocAnchor(
				row({ key: "", name: "Peer (choose one)", type: "talent" }),
				LINKED_SKILL_DOCS,
				LINKED_TALENT_DOCS,
			),
		).toBeNull();
		expect(packDocAnchor(row(), [], [])).toBeNull();
	});
});

// ---------------------------------------------------------------- adoption guard

describe("pack-doc links — library adoption guard (bead n2b2)", () => {
	const view = readFileSync(
		"src/roguetrader/sheet/actor/advancement-view-model.ts",
		"utf8",
	);
	const dialog = readFileSync(
		"src/roguetrader/sheet/actor/advancement-dialog.ts",
		"utf8",
	);
	const resolvePath = readFileSync("src/roguetrader/sheet/pack-resolve.ts", "utf8");

	test("the advancement view model imports the library (no local copies)", () => {
		expect(view).toContain('from "../pack-doc-links"');
		for (const name of ["resolveSkillDoc", "resolveTalentDoc", "docLinkUuid"]) {
			expect(view).toContain(name);
		}
		// No local resolver definitions may return after the extraction.
		expect(view).not.toMatch(/export function resolve(Talent|Skill)Doc\(/);
		expect(view).not.toMatch(/function docLinkUuid\(/);
		expect(view).not.toMatch(/export function resolvePackDocument|async function openDocumentSheet/);
	});

	test("the advancement dialog consumes the library import path", () => {
		expect(dialog).toContain('from "../pack-doc-links"');
		expect(dialog).not.toContain("resolveSkillDoc,\n} from \"./advancement-view-model\"");
	});

	test("pack-resolve re-exports the library with the open path (one adopter import point)", () => {
		expect(resolvePath).toContain('export {');
		for (const name of ["docLinkUuid", "packDocAnchor", "resolveSkillDoc", "resolveTalentDoc"]) {
			expect(resolvePath).toContain(name);
		}
	});

	test("the library module stays Foundry-free (no open path duplicated into it)", () => {
		const library = readFileSync("src/roguetrader/sheet/pack-doc-links.ts", "utf8");
		// Definitions only — the doc comment may reference the open path.
		expect(library).not.toMatch(/export (async )?function (openDocumentSheet|resolvePackDocument)/);
		expect(library).not.toContain("getPorts");
		expect(library).not.toContain("game.");
	});
});