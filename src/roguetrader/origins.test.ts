import { describe, expect, test } from "bun:test";
import {
	allowedColumns,
	characteristicDeltas,
	effectiveMechanics,
	evaluateOriginDice,
	fateFromTable,
	ORIGIN_ENTRIES,
	ORIGIN_ROWS,
	originByKey,
	originsInRow,
	resolveOrigins,
	SUGGESTED_HOME_WORLDS,
	type CharMod,
} from "./origins";

describe("origin path chart (Core Rulebook p16)", () => {
	test("every row is present with six contiguous columns", () => {
		for (const row of ORIGIN_ROWS) {
			const entries = originsInRow(row);
			expect(entries.length).toBe(6);
			expect(entries.map((e) => e.col)).toEqual([0, 1, 2, 3, 4, 5]);
		}
	});

	test("keys are unique across the whole chart", () => {
		const keys = ORIGIN_ENTRIES.map((entry) => entry.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("first row is completely open", () => {
		expect(allowedColumns("home-world", null).length).toBe(6);
	});

	// Book example (p16): Void Born (col 1) -> Scapegrace (below), Scavenger
	// (adjacent) or Stubjack (adjacent).
	test("book example: Void Born reaches Scapegrace, Scavenger, Stubjack", () => {
		const cols = allowedColumns("birthright", 1);
		const names = originsInRow("birthright")
			.filter((e) => cols.includes(e.col))
			.map((e) => e.name);
		expect(names).toContain("Scapegrace");
		expect(names).toContain("Scavenger");
		expect(names).toContain("Stubjack");
		expect(names).not.toContain("Child of the Creed");
	});

	// Book example (p16): Scavenger is on the edge, so only Tainted (below)
	// or Criminal (only adjacent) are reachable.
	test("book example: edge Scavenger reaches only Tainted and Criminal", () => {
		const cols = allowedColumns("lure", 0);
		const names = originsInRow("lure")
			.filter((e) => cols.includes(e.col))
			.map((e) => e.name);
		expect(names).toEqual(["Tainted", "Criminal"]);
	});
});

describe("origin mechanics", () => {
	test("death world characteristic modifiers match the book", () => {
		const entry = originByKey("death-world");
		expect(entry).toBeDefined();
		const deltas = characteristicDeltas(entry!.mechanics);
		expect(deltas.s).toBe(5);
		expect(deltas.t).toBe(5);
		expect(deltas.wp).toBe(-5);
		expect(deltas.fel).toBe(-5);
	});

	test("choice groups are only picked, never pre-applied", () => {
		const entry = originByKey("scapegrace")!;
		const deltas = characteristicDeltas(entry.mechanics);
		// Only the choice exists; nothing applied until the player picks.
		expect(Object.keys(deltas)).toHaveLength(0);
		const chosen = characteristicDeltas(entry.mechanics, [
			{ key: "int", value: 3 },
		]);
		expect(chosen.int).toBe(3);
	});

	test("effectiveMechanics picks the chosen variant", () => {
		const entry = originByKey("criminal")!;
		expect(entry.variants?.length).toBe(3);
		const wanted = effectiveMechanics(entry, "wanted-fugitive");
		expect(wanted.talents).toContain("Peer (Underworld)");
		const hunted = effectiveMechanics(entry, "hunted-by-a-crime-baron");
		expect(hunted.characteristics).toEqual([
			{ key: "per", value: 3 },
		]);
		// Unknown variant falls back to the (empty) entry mechanics.
		expect(effectiveMechanics(entry, "nope").characteristics).toBeUndefined();
	});

	test("entries with variants keep base mechanics empty (no double-apply)", () => {
		for (const entry of ORIGIN_ENTRIES) {
			if (entry.variants) {
				expect(Object.keys(entry.mechanics)).toHaveLength(0);
			}
		}
	});

	test("wounds dice and fate tables are well-formed", () => {
		for (const entry of ORIGIN_ENTRIES) {
			const mechanics = entry.variants
				? entry.variants.flatMap((v) => [v.mechanics])
				: [entry.mechanics];
			for (const m of mechanics) {
				if (m.woundsDice) expect(m.woundsDice).toMatch(/^1d5(\+\d)?$/);
				if (m.fateTable) {
					// Bands cover 1-10 in ascending order.
					expect(m.fateTable[0].max).toBeGreaterThanOrEqual(1);
					for (let i = 1; i < m.fateTable.length; i += 1) {
						expect(m.fateTable[i].max).toBeGreaterThan(
							m.fateTable[i - 1].max,
						);
					}
					expect(m.fateTable[m.fateTable.length - 1].max).toBe(10);
				}
			}
		}
	});

	test("Table 1-1 suggested home worlds reference real keys", () => {
		for (const [career, worlds] of Object.entries(SUGGESTED_HOME_WORLDS)) {
			for (const world of worlds) {
				const entry = originByKey(world);
				expect(entry?.row).toBe("home-world");
			}
			expect(career.length).toBeGreaterThan(0);
		}
	});
});

describe("evaluateOriginDice", () => {
	let calls = 0;
	const seqRoll = () => {
		calls += 1;
		return calls;
	};

	test("parses 1d5+2 style book notation", () => {
		calls = 0;
		// One d5 roll returning 1 (sequence) + flat 2.
		expect(evaluateOriginDice("1d5+2", seqRoll)).toBe(3);
	});

	test("parses multiple dice and negative flats", () => {
		calls = 0;
		expect(evaluateOriginDice("2d10", seqRoll)).toBe(3); // 1 + 2
		calls = 0;
		expect(evaluateOriginDice("2d10-1", seqRoll)).toBe(2); // 1 + 2 - 1
	});

	test("unknown notation yields 0", () => {
		expect(evaluateOriginDice("garbage", seqRoll)).toBe(0);
	});
});

describe("fateFromTable", () => {
	const table = [
		{ max: 5, value: 2 },
		{ max: 10, value: 3 },
	];

	test("bands map d10 rolls to values", () => {
		expect(fateFromTable(table, 1)).toBe(2);
		expect(fateFromTable(table, 5)).toBe(2);
		expect(fateFromTable(table, 6)).toBe(3);
		expect(fateFromTable(table, 10)).toBe(3);
	});

	test("three-band noble born table", () => {
		const noble = [
			{ max: 3, value: 2 },
			{ max: 9, value: 3 },
			{ max: 10, value: 4 },
		];
		expect(fateFromTable(noble, 3)).toBe(2);
		expect(fateFromTable(noble, 4)).toBe(3);
		expect(fateFromTable(noble, 10)).toBe(4);
	});
});

describe("resolveOrigins", () => {
	test("merges fixed mechanics, variant, and choices without double-apply", () => {
		const resolved = resolveOrigins({
			"home-world": { key: "death-world", optionChoice: "Jaded" },
			birthright: { key: "scapegrace", charChoice: [{ key: "int", value: 3 }] },
			lure: { key: "criminal", variantKey: "hunted-by-a-crime-baron" },
			trials: { key: "calamity", optionChoice: "Nerves of Steel" },
			motivation: { key: "endurance" },
		});
		// Home world fixed + birthright choice + criminal variant.
		expect(resolved.characteristics.s).toBe(5);
		expect(resolved.characteristics.t).toBe(5);
		expect(resolved.characteristics.wp).toBe(-5);
		expect(resolved.characteristics.fel).toBe(-5);
		expect(resolved.characteristics.int).toBe(3);
		expect(resolved.characteristics.per).toBe(3);
		// Skills: death world + scapegrace.
		expect(resolved.skills).toContain("Survival");
		expect(resolved.skills).toContain("Sleight of Hand");
		// Options recorded separately from talents.
		expect(resolved.options).toContain("Jaded");
		expect(resolved.options).toContain("Nerves of Steel");
		// Calamity profit factor -1; wounds dice from home world; wound bonus +1.
		expect(resolved.profitFactor).toBe(-1);
		expect(resolved.woundsDice).toEqual(["1d5+2"]);
		expect(resolved.woundBonus).toBe(1);
		// Fate table comes from the home world.
		expect(resolved.fateTable).toEqual([
			{ max: 5, value: 2 },
			{ max: 10, value: 3 },
		]);
	});

	test("empty picks resolve to a clean bundle", () => {
		const resolved = resolveOrigins({});
		expect(Object.keys(resolved.characteristics)).toHaveLength(0);
		expect(resolved.fateTable).toBeNull();
		expect(resolved.profitFactor).toBe(0);
	});

	test("alternateChoice applies exactly the chosen blob", () => {
		const fate = resolveOrigins({
			lure: { key: "tainted", variantKey: "insane", alternate: 1 },
		});
		expect(fate.fateDelta).toBe(-1);
		expect(fate.characteristics.fel).toBeUndefined();
		expect(fate.insanityDice).toEqual(["2d10"]);
		const fel = resolveOrigins({
			lure: { key: "tainted", variantKey: "insane", alternate: 0 },
		});
		expect(fel.characteristics.fel).toBe(-3);
		expect(fel.fateDelta).toBe(0);
	});

	test("unknown picks are ignored, not thrown", () => {
		const resolved = resolveOrigins({
			lure: { key: "does-not-exist" },
		});
		expect(Object.keys(resolved.characteristics)).toHaveLength(0);
	});
});

describe("choice coverage", () => {
	test("every optionChoice, characteristicChoice and alternateChoice is non-empty", () => {
		for (const entry of ORIGIN_ENTRIES) {
			const blobs = entry.variants
				? entry.variants.map((v) => v.mechanics)
				: [entry.mechanics];
			for (const m of blobs) {
				if (m.optionChoice) expect(m.optionChoice.length).toBeGreaterThan(0);
				if (m.characteristicChoice)
					expect(m.characteristicChoice.length).toBeGreaterThan(0);
				if (m.alternateChoice)
					expect(m.alternateChoice.length).toBeGreaterThan(0);
			}
		}
	});

	test("characteristic mods use valid keys and non-zero values", () => {
		const validKeys = new Set([
			"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
		] satisfies CharMod["key"][]);
		for (const entry of ORIGIN_ENTRIES) {
			const blobs = entry.variants
				? entry.variants.map((v) => v.mechanics)
				: [entry.mechanics];
			for (const m of blobs) {
				for (const mod of m.characteristics ?? []) {
					expect(validKeys.has(mod.key)).toBe(true);
					expect(mod.value).not.toBe(0);
				}
				for (const group of m.characteristicChoice ?? []) {
					expect(group.length).toBeGreaterThan(0);
					for (const mod of group) {
						expect(validKeys.has(mod.key)).toBe(true);
						expect(mod.value).not.toBe(0);
					}
				}
				for (const alt of m.alternateChoice ?? []) {
					expect(alt.label.length).toBeGreaterThan(0);
				}
			}
		}
	});
});