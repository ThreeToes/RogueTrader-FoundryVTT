import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	buildCharacteristicViews,
	CHAR_SHORTS,
	characteristicValues,
	findOwnedSkillForRow,
	LADDER_MAX,
	LADDER_OPTIONS,
	mergeOwnedAndCatalogRows,
	skillNameKey,
} from "./skills-domain";

describe("LADDER_MAX (bead i1f4 — three-step ladder, Core Rulebook p74)", () => {
	it("is 3 (Known / +10 / +20)", () => {
		expect(LADDER_MAX).toBe(3);
	});

	it("equals the LADDER_OPTIONS length (never drifts)", () => {
		expect(LADDER_MAX).toBe(LADDER_OPTIONS.length);
	});

	it("is mirrored by the Skill schema's ladder NumberField max (source guard)", () => {
		// The schema module touches `foundry` at load, so guard the source
		// text instead (advancement-dialog-guard precedent).
		const source = readFileSync("src/roguetrader/data/item/skill.ts", "utf8");
		const ladderField = source.slice(
			source.indexOf("ladder: new foundry.data.fields.NumberField"),
		);
		expect(ladderField).toContain("max: 3");
	});
});

describe("skillNameKey (t093 semantics)", () => {
	it("trims and lowercases", () => {
		expect(skillNameKey("  Speak Language (Low Gothic) ")).toBe(
			"speak language (low gothic)",
		);
	});
});

describe("findOwnedSkillForRow (bead wxkw — shared preview/application matcher)", () => {
	const owned = [
		{ key: "awareness", name: "Awareness", ladder: 2 },
		{ key: "", name: "tech-use", ladder: 1 }, // keyless owned item (default-skill hook)
		{ key: "", name: "  Common Lore (Imperium) ", ladder: 1 },
	];
	const row = (over: Record<string, unknown> = {}) => ({
		key: "",
		name: "",
		...over,
	});

	it("matches by pack key first", () => {
		expect(findOwnedSkillForRow(owned, row({ key: "awareness" }))).toBe(owned[0]);
	});

	it("matches by exact name after the key fails", () => {
		expect(findOwnedSkillForRow(owned, row({ name: "Common Lore (Imperium)" })))
			.toBe(owned[2]);
	});

	it("matches trimmed + case-insensitively (t093 semantics)", () => {
		// The bead-wxkw failure mode: a keyless owned item whose name differs
		// from the row's name only by case/whitespace.
		expect(
			findOwnedSkillForRow(
				[{ key: "", name: "  awareness ", ladder: 2 }],
				row({ name: "Awareness" }),
			),
		).toMatchObject({ name: "  awareness " });
		expect(findOwnedSkillForRow(owned, row({ name: "COMMON LORE (imperium)" })))
			.toBe(owned[2]);
	});

	it("keys win even when a name match appears earlier in the list", () => {
		// The two-pass key-first shape (the live application's semantics): a
		// key match anywhere beats an earlier accidental name match.
		const mixed = [
			{ key: "", name: "Awareness", ladder: 1 },
			{ key: "awareness", name: "Awareness (pack)", ladder: 3 },
		];
		expect(
			findOwnedSkillForRow(mixed, row({ key: "awareness", name: "Awareness" })),
		).toBe(mixed[1]);
	});

	it("an empty row key never matches a keyless owned skill by key", () => {
		// The old live path matched empty system.key === empty row.key and
		// could bump an unrelated keyless skill.
		const keyless = [{ key: "", name: "Dodge", ladder: 1 }];
		expect(findOwnedSkillForRow(keyless, row({ name: "Awareness" })))
			.toBeUndefined();
	});

	it("returns undefined on no match; blank candidate names never match", () => {
		expect(findOwnedSkillForRow(owned, row({ name: "Unheard-Of" })))
			.toBeUndefined();
		expect(
			findOwnedSkillForRow([{ key: "x", name: "" }], row({ name: "x" })),
		).toBeUndefined();
	});

	it("compares against BOTH the resolved row name and the raw row name", () => {
		// Key-only raw row name ('tech-use') vs the display name the button
		// carries ('Tech-Use'): either side alone must find the owned skill.
		expect(findOwnedSkillForRow(owned, row({ name: "tech-use" }), "Tech-Use"))
			.toBe(owned[1]);
		expect(
			findOwnedSkillForRow(
				[{ key: "", name: "Tech-Use", ladder: 1 }],
				row({ name: "tech-use-tech" }),
			),
		).toBeUndefined(); // name-key compare, not substring
	});
});

describe("mergeOwnedAndCatalogRows (bead 6l90)", () => {
	const catalog = [
		{ id: "c1", name: "Awareness", characteristic: "per" },
		{ id: "c2", name: "Dodge", characteristic: "ag" },
		{
			id: "c3",
			name: "Speak Language (Low Gothic)",
			characteristic: "int",
			common: true,
		},
	];

	it("keeps owned rows and drops matching catalog entries", () => {
		const rows = mergeOwnedAndCatalogRows(
			[{ id: "o1", name: "Dodge", system: { ladder: 2 } }],
			catalog,
		);
		expect(rows.map((r) => [r.name, r.owned])).toEqual([
			["Awareness", false],
			["Dodge", true],
			["Speak Language (Low Gothic)", false],
		]);
		const dodge = rows.find((r) => r.name === "Dodge");
		expect(dodge).toMatchObject({
			owned: true,
			id: "o1",
			ladder: 2,
			advanced: false,
			ladderOptions: LADDER_OPTIONS,
		});
	});

	it("matches owned vs catalog case-insensitively and trimmed", () => {
		// The pre-6l90 bug: character-sheet matching was case-sensitive, so
		// an owned "dodge" rendered alongside the catalog's "Dodge".
		const rows = mergeOwnedAndCatalogRows(
			[{ id: "o1", name: "  dodge ", system: { ladder: 1 } }],
			catalog,
		);
		expect(rows.filter((r) => r.name === "Dodge")).toHaveLength(0);
		const owned = rows.find((r) => r.name === "  dodge ");
		expect(owned?.owned).toBe(true);
	});

	it("keeps advanced flag from owned system", () => {
		const rows = mergeOwnedAndCatalogRows(
			[{ id: "o1", name: "Forbidden Lore (Xenos)", system: { ladder: 1, advanced: true } }],
			[],
		);
		expect(rows[0]).toMatchObject({ advanced: true, ladder: 1 });
	});

	it("sorts alphabetically", () => {
		const rows = mergeOwnedAndCatalogRows(
			[{ id: "o1", name: "Dodge", system: { ladder: 1 } }],
			catalog,
		);
		const names = rows.map((r) => r.name);
		expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
	});

	it("defaults ladder to 0 for catalog rows and missing owned system", () => {
		const rows = mergeOwnedAndCatalogRows([{ id: "o1", name: "Dodge" }], [
			{ id: "c1", name: "Awareness", characteristic: "per" },
		]);
		expect(rows.map((r) => r.ladder)).toEqual([0, 0]);
	});
});

describe("characteristic views (bead 6l90)", () => {
	const system: {
		characteristics: Record<string, { value: number; unnatural: number }>;
		characteristicBonus(key: string): number;
		effectiveCharacteristicBonus(key: string): number;
	} = {
		characteristics: {
			ws: { value: 42, unnatural: 1 },
			s: { value: 55, unnatural: 2 },
		},
		characteristicBonus(key: string) {
			return Math.floor((system.characteristics[key]?.value ?? 0) / 10);
		},
		effectiveCharacteristicBonus(key: string) {
			return (
				this.characteristicBonus(key) *
				(system.characteristics[key]?.unnatural ?? 1)
			);
		},
	};
	const format = (key: string, vars?: Record<string, unknown>) =>
		`${key}:${JSON.stringify(vars ?? {})}`;

	it("builds label/bonus views", () => {
		const views = buildCharacteristicViews(system, format);
		expect(views).toHaveLength(2);
		const ws = views.find((v) => v.key === "ws");
		expect(ws).toMatchObject({
			label: "CHARACTERISTIC.WS",
			value: 42,
			bonus: 4,
			effectiveBonus: 4,
			unnatural: 1,
		});
	});

	it("uses the effective bonus in tooltip and pips for unnatural > 1", () => {
		const s = buildCharacteristicViews(system, format).find(
			(v) => v.key === "s",
		);
		expect(s?.bonus).toBe(5);
		expect(s?.effectiveBonus).toBe(10);
		expect(s?.pips).toEqual([
			{ value: 2, lit: true },
			{ value: 3, lit: false },
			{ value: 4, lit: false },
			{ value: 5, lit: false },
			{ value: 6, lit: false },
		]);
	});

	it("exposes the short-form table", () => {
		expect(CHAR_SHORTS.ws).toBe("WS");
		expect(CHAR_SHORTS.fel).toBe("Fel");
	});

	// Bead xu83: the sheet shows the effective value and the delta so a
	// permanent affliction/mutation change is visible, while the editable
	// input above keeps editing the base value.
	it("reports the effective value and delta when owned items modify it", () => {
		const withItems = {
			characteristics: { ag: { value: 40, unnatural: 1 } },
			characteristicBonus: () => 2,
			effectiveCharacteristicBonus: () => 2,
			effectiveCharacteristicValue: () => 25,
		};
		const view = buildCharacteristicViews(withItems, format)[0];
		expect(view).toMatchObject({
			value: 40,
			effectiveValue: 25,
			delta: -15,
		});
		expect(view.deltaTooltip).toContain("CHARACTER.EFFECTIVE_TOOLTIP");
		expect(view.deltaTooltip).toContain("25");
	});

	it("delta is zero when the system has no owned-item accessor", () => {
		const view = buildCharacteristicViews(system, format)[0];
		expect(view.delta).toBe(0);
		expect(view.effectiveValue).toBe(view.value);
	});
});describe("characteristicValues (bead bdu4)", () => {
	it("maps present values to a plain record", () => {
		expect(
			characteristicValues({
				characteristics: { ws: { value: 40 }, bs: { value: 35 } },
			}),
		).toEqual({ ws: 40, bs: 35 });
	});

	it("yields an empty record when characteristics is missing", () => {
		expect(characteristicValues({})).toEqual({});
		expect(characteristicValues({ characteristics: undefined })).toEqual({});
	});

	it("preserves the call sites' exact fallback (only the record is coalesced)", () => {
		// `?? {}` guards the missing record; each entry maps straight from
		// v.value with no per-key fallback, as the original sites did.
		expect(characteristicValues({ characteristics: null })).toEqual({});
		expect(
			characteristicValues({ characteristics: { ws: { value: 40 } } }),
		).toEqual({ ws: 40 });
	});
});