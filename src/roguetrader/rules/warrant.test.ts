import { beforeEach, describe, expect, test } from "bun:test";
import {
	allowedWarrantColumns,
	pruneWarrantPicks,
	resolveWarrant,
	setWarrantEntries,
	type WarrantEntry,
	WARRANT_ROWS,
	warrantEntryFromDoc,
	warrantRowColumns,
} from "./warrant";

describe("pruneWarrantPicks (bead 6yz8, the shared path-pruning walk)", () => {
	// A legal full path: a2 (col 2) -> b3 (col 3) -> c3 (col 3) -> d3 (col 3)
	// -> e3 (col 3) -> f3 (col 3).
	const full: Record<string, string> = {
		"warrant-age": "a2",
		"fortune-fate": "b3",
		acquisition: "c3",
		sanction: "d3",
		contacts: "e3",
		renown: "f3",
	};

	test("a downstream pick reachable within +-1 column survives", () => {
		// a2 -> b3 is legal (|3-2| = 1); the rest of the path is untouched.
		expect(pruneWarrantPicks(full, "warrant-age")).toEqual(full);
	});

	test("an unreachable downstream pick is dropped, input untouched", () => {
		const before = { ...full };
		// Changing to a1 (col 1) makes b3 (col 3) unreachable.
		const picks = { ...full, "warrant-age": "a1" };
		const pruned = pruneWarrantPicks(picks, "warrant-age");
		expect(pruned["warrant-age"]).toBe("a1");
		expect(pruned["fortune-fate"]).toBeUndefined();
		expect(full).toEqual(before); // pure: input not mutated
	});

	test("a dropped pick resets the anchor and downstream re-anchors", () => {
		// sanction d1 (col 1) is unreachable from c3 (col 3) — dropped; the
		// anchor resets to null, and contacts e3 (col 3) survives past the
		// gap (null allows everything) while keeping its own column.
		const picks: Record<string, string> = { ...full, sanction: "d1" };
		const pruned = pruneWarrantPicks(picks, "warrant-age");
		expect(pruned.sanction).toBeUndefined();
		expect(pruned.contacts).toBe("e3");
		expect(pruned.renown).toBe("f3");
	});

	test("picks before fromRow are untouched even when they look illegal", () => {
		const picks = {
			"warrant-age": "a2",
			"fortune-fate": "b3",
			acquisition: "c0", // unreachable from b3, but ABOVE fromRow
			sanction: "d2",
		};
		const pruned = pruneWarrantPicks(picks, "sanction");
		expect(pruned["warrant-age"]).toBe("a2");
		expect(pruned["fortune-fate"]).toBe("b3");
		expect(pruned.acquisition).toBe("c0");
		// sanction IS fromRow: the anchor row itself is never examined, so
		// even its odd column is kept.
		expect(pruned.sanction).toBe("d2");
	});

	test("an unpicked row resets the anchor (null allows everything)", () => {
		// fortune-fate removed: anchor at b is a2, the gap resets the anchor
		// to null, and with a null anchor every column of the next row is
		// allowed — so c3 and its legal successor survive.
		const picks = { "warrant-age": "a2", acquisition: "c3", sanction: "d3" };
		const pruned = pruneWarrantPicks(picks, "warrant-age");
		expect(pruned).toEqual(picks); // nothing was dropped
	});

	test("an unknown stored key is dropped like an unreachable pick", () => {
		const picks = { ...full, acquisition: "gone" };
		const pruned = pruneWarrantPicks(picks, "warrant-age");
		expect(pruned.acquisition).toBeUndefined();
	});
});

/**
 * Synthetic chart mirroring the p34 column layout: Acquisition spans columns
 * 0-6 while the other rows use 1-5 (Renown 2-4).
 */
function entry(
	row: WarrantEntry["row"],
	col: number,
	key: string,
	shipPoints = 0,
	profitFactor = 0,
	notes: string[] = [],
): WarrantEntry {
	return {
		key,
		row,
		col,
		name: key,
		description: "",
		mechanics: { shipPoints, profitFactor, notes },
	};
}

beforeEach(() => {
	setWarrantEntries([
		entry("warrant-age", 1, "a1", 4, 2),
		entry("warrant-age", 2, "a2", 6, 4),
		entry("warrant-age", 3, "a3", 8, 6),
		entry("warrant-age", 4, "a4", 10, 8),
		entry("warrant-age", 5, "a5", 12, 10, ["One Archeotech component may be purchased."]),
		entry("fortune-fate", 1, "b1", 12, 10),
		entry("fortune-fate", 2, "b2", 10, 8),
		entry("fortune-fate", 3, "b3", 8, 6),
		entry("fortune-fate", 4, "b4", 6, 4),
		entry("fortune-fate", 5, "b5", 4, 2),
		entry("acquisition", 0, "c0", 2, 16),
		entry("acquisition", 1, "c1", 4, 10),
		entry("acquisition", 2, "c2", 6, 8),
		entry("acquisition", 3, "c3", 8, 6),
		entry("acquisition", 4, "c4", 10, 4),
		entry("acquisition", 5, "c5", 12, 2),
		entry("acquisition", 6, "c6", 16, 2),
		entry("sanction", 1, "d1", 4, 10, ["One Xenostech Component may be purchased."]),
		entry("sanction", 2, "d2", 6, 8),
		entry("sanction", 3, "d3", 8, 6),
		entry("sanction", 4, "d4", 10, 4),
		entry("sanction", 5, "d5", 12, 2),
		entry("contacts", 1, "e1", 4, 10),
		entry("contacts", 2, "e2", 6, 8),
		entry("contacts", 3, "e3", 8, 6),
		entry("contacts", 4, "e4", 10, 4),
		entry("contacts", 5, "e5", 12, 2),
		entry("renown", 2, "f2", 6, 12),
		entry("renown", 3, "f3", 10, 8),
		entry("renown", 4, "f4", 14, 4),
	]);
});

describe("warrant chart adjacency (Into the Storm p33)", () => {
	test("six rows in chart order", () => {
		expect(WARRANT_ROWS).toEqual([
			"warrant-age",
			"fortune-fate",
			"acquisition",
			"sanction",
			"contacts",
			"renown",
		]);
	});

	test("the first row is completely open", () => {
		expect(allowedWarrantColumns("warrant-age", null)).toEqual([1, 2, 3, 4, 5]);
	});

	test("later rows allow below and either neighbour", () => {
		// Book example: Age of Redemption (col 2) -> Ascending / Rising Star / Stable.
		expect(allowedWarrantColumns("fortune-fate", 2)).toEqual([1, 2, 3]);
		// Rising Star (col 1) -> Exile / Blackmail / Prize-of-War.
		expect(allowedWarrantColumns("acquisition", 1)).toEqual([0, 1, 2]);
	});

	test("Acquisition's extremes have a single choice below (p33)", () => {
		expect(allowedWarrantColumns("sanction", 0)).toEqual([1]); // Exile -> Halo Artefacts
		expect(allowedWarrantColumns("sanction", 6)).toEqual([5]); // Reward -> Age of Plunder
	});

	test("edge rows give the two documented choices", () => {
		expect(allowedWarrantColumns("fortune-fate", 5)).toEqual([4, 5]);
		expect(allowedWarrantColumns("renown", 1)).toEqual([2]);
	});

	test("warrantRowColumns lists the distinct occupied columns", () => {
		expect(warrantRowColumns("acquisition")).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(warrantRowColumns("renown")).toEqual([2, 3, 4]);
	});
});

describe("warrantEntryFromDoc (bead 5rk0, the shared pack mapping)", () => {
	test("maps a full pack document", () => {
		expect(
			warrantEntryFromDoc({
				name: "Age of Redemption",
				system: {
					key: "a6",
					row: "warrant-age",
					col: 6,
					description: "Book prose.",
					mechanics: {
						shipPoints: 8,
						profitFactor: 6,
						notes: ["One Archeotech component."],
					},
				},
			}),
		).toEqual({
			key: "a6",
			row: "warrant-age",
			col: 6,
			name: "Age of Redemption",
			description: "Book prose.",
			mechanics: {
				shipPoints: 8,
				profitFactor: 6,
				notes: ["One Archeotech component."],
			},
		});
	});

	test("returns null for a doc missing its key or carrying an off-chart row", () => {
		expect(warrantEntryFromDoc({ name: "Orphan", system: { row: "warrant-age" } })).toBeNull();
		expect(
			warrantEntryFromDoc({ name: "Orphan", system: { key: "x", row: "not-a-row" } }),
		).toBeNull();
	});
});

describe("resolveWarrant", () => {
	test("sums every pick's SP/PF and collects notes + renown", () => {
		const resolved = resolveWarrant([
			{ row: "warrant-age", key: "a2" },
			{ row: "fortune-fate", key: "b1" },
			{ row: "acquisition", key: "c0" },
			{ row: "sanction", key: "d1" },
			{ row: "contacts", key: "e1" },
			{ row: "renown", key: "f2" },
		]);
		// 6+12+2+4+4+6
		expect(resolved.shipPoints).toBe(34);
		// 4+10+16+10+10+12
		expect(resolved.profitFactor).toBe(62);
		expect(resolved.renown).toBe("f2");
		expect(resolved.notes).toEqual([
			"d1: One Xenostech Component may be purchased.",
		]);
	});

	test("unknown or mismatched picks are ignored, not thrown", () => {
		const resolved = resolveWarrant([
			{ row: "warrant-age", key: "nope" },
			{ row: "not-a-row", key: "a2" },
			// key exists but in a different row
			{ row: "sanction", key: "a2" },
			{ row: "warrant-age", key: "a1" },
		]);
		expect(resolved.picks).toEqual([{ row: "warrant-age", key: "a1" }]);
		expect(resolved.shipPoints).toBe(4);
		expect(resolved.profitFactor).toBe(2);
		expect(resolved.renown).toBe("");
	});

	test("an empty pick list resolves to zeroes", () => {
		const resolved = resolveWarrant([]);
		expect(resolved).toEqual({
			picks: [],
			shipPoints: 0,
			profitFactor: 0,
			notes: [],
			renown: "",
		});
	});
});
