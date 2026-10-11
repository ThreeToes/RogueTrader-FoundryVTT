/**
 * Shared pack-doc catalog builders (bead 656m): pin the RICHER shapes the
 * advancement dialog relies on (uuid/key for the rank-row doc links), the
 * fallbacks, and the skips — one test for both consumers.
 */
import { describe, expect, test } from "bun:test";
import {
	buildSkillCatalog,
	buildTalentCatalog,
	type OptionDocLike,
} from "./catalog";
import type { CatalogSkill } from "../rules/creation";

const doc = (over: OptionDocLike): OptionDocLike => over;

describe("buildSkillCatalog", () => {
	test("keeps id/name/key/characteristic/uuid (rich shape, doc links)", () => {
		const out = buildSkillCatalog([
			doc({
				id: "c7",
				name: "Awareness",
				uuid: "Compendium.x.Awareness",
				system: { key: "awareness", characteristic: "per" },
			}),
		]);
		expect(out).toEqual([
			{
				id: "c7",
				name: "Awareness",
				key: "awareness",
				characteristic: "per",
				uuid: "Compendium.x.Awareness",
			},
		]);
	});

	test("defaults: missing key -> '', missing characteristic -> int", () => {
		const out = buildSkillCatalog([{ name: "Charm" } as OptionDocLike]);
		expect(out).toEqual([
			{
				id: "",
				name: "Charm",
				key: "",
				characteristic: "int",
				uuid: "",
			},
		]);
	});

	test("skips nameless docs (nothing to display or match)", () => {
		const out = buildSkillCatalog([
			{ system: { key: "awareness", characteristic: "per" } } as OptionDocLike,
		]);
		expect(out).toEqual([]);
	});

	test("entries satisfy the thinner grant shape ({name, characteristic})", () => {
		const catalog: CatalogSkill[] = buildSkillCatalog([
			doc({ name: "Awareness", system: { characteristic: "per" } }),
		]);
		expect(catalog[0]?.name).toBe("Awareness");
		expect(catalog[0]?.characteristic).toBe("per");
	});
});

describe("buildTalentCatalog", () => {
	test("keeps key/name/description/uuid (rich shape, doc links)", () => {
		const out = buildTalentCatalog([
			doc({
				name: "Jaded",
				uuid: "Compendium.x.Jaded",
				system: { key: "jaded", description: "You are jaded." },
			}),
		]);
		expect(out).toEqual([
			{
				key: "jaded",
				name: "Jaded",
				description: "You are jaded.",
				uuid: "Compendium.x.Jaded",
			},
		]);
	});

	test("defaults: missing description -> empty string", () => {
		const out = buildTalentCatalog([
			doc({ name: "Jaded", system: { key: "jaded" } }),
		]);
		expect(out).toEqual([
			{ key: "jaded", name: "Jaded", description: "", uuid: "" },
		]);
	});

	test("skips docs without a name or without a system.key", () => {
		const out = buildTalentCatalog([
			doc({ system: { key: "jaded" } }),
			doc({ name: "Jaded" }),
		]);
		expect(out).toEqual([]);
	});

	test("preserves pack order (callers own sorting)", () => {
		const out = buildTalentCatalog([
			doc({ name: "Second", system: { key: "b" } }),
			doc({ name: "First", system: { key: "a" } }),
		]);
		expect(out.map((e) => e.name)).toEqual(["Second", "First"]);
	});
});