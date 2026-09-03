import { describe, expect, test } from "bun:test";
import {
	buildTableResults,
	documentId,
	resolveEntryType,
	toTableSourceDocument,
} from "../utils/compendia";

describe("resolveEntryType", () => {
	test("honors a declared non-generic type", () => {
		expect(resolveEntryType({ type: "aptitude" }, "aptitudes")).toBe(
			"aptitude",
		);
	});

	test("maps legacy generic Item type via folder defaults", () => {
		expect(resolveEntryType({ type: "Item" }, "skills")).toBe("skill");
		expect(resolveEntryType({ type: "Item" }, "talents")).toBe("talent");
		expect(resolveEntryType({ type: "Item" }, "unknown")).toBe("gear");
	});

	test("infers weapon type from system.class", () => {
		expect(
			resolveEntryType(
				{ type: "Item", system: { class: "pistol" } },
				"weapons",
			),
		).toBe("ranged-weapon");
		expect(
			resolveEntryType({ type: "Item", system: { class: "basic" } }, "weapons"),
		).toBe("ranged-weapon");
		expect(
			resolveEntryType({ type: "Item", system: { class: "melee" } }, "weapons"),
		).toBe("melee-weapon");
	});

	test("falls back to gear when the type is missing", () => {
		expect(resolveEntryType({}, "misc")).toBe("gear");
	});
});

describe("buildTableResults (criticals scaffolding)", () => {
	test("pending count generates labelled placeholder rows", () => {
		const rows = buildTableResults({ pending: 10, name: "T" });
		expect(rows).toHaveLength(10);
		expect(rows[0].range).toEqual([1, 1]);
		expect(rows[9].range).toEqual([10, 10]);
		expect(String(rows[0].text)).toContain("pending extraction");
		expect(String(rows[4].text)).toContain("severity 5");
	});

	test("string rows auto-range cumulatively", () => {
		const rows = buildTableResults({
			name: "T",
			results: ["one", "two", "three"],
		});
		expect(rows.map((r) => r.range)).toEqual([
			[1, 1],
			[2, 2],
			[3, 3],
		]);
	});

	test("weights widen ranges; explicit ranges are honored", () => {
		const rows = buildTableResults({
			name: "T",
			results: [
				{ text: "a", weight: 3 },
				{ text: "b", range: [9, 10] },
			],
		});
		expect(rows[0].range).toEqual([1, 3]);
		expect(rows[1].range).toEqual([9, 10]);
	});

	test("result ids are stable and distinct", () => {
		const rows = buildTableResults({ pending: 2, name: "T" });
		expect(rows[0]._id).not.toBe(rows[1]._id);
		expect(buildTableResults({ pending: 2, name: "T" })[0]._id).toBe(
			rows[0]._id,
		);
	});

	test("no results and no pending -> empty table", () => {
		expect(buildTableResults({ name: "T" })).toEqual([]);
	});
});

describe("toTableSourceDocument", () => {
	test("shapes a rollable table source", () => {
		const doc = toTableSourceDocument({
			name: "Critical Hit (Energy, Head)",
			formula: "1d10",
			pending: 10,
		});
		expect(doc.formula).toBe("1d10");
		expect(doc.replacement).toBe(true);
		expect(doc.displayRoll).toBe(true);
		expect(doc.results).toHaveLength(10);
		expect(doc._id).toBe(documentId("Critical Hit (Energy, Head)"));
	});

	test("authored results replace pending placeholders", () => {
		const doc = toTableSourceDocument({
			name: "T",
			pending: 10,
			results: ["done"],
		});
		expect(doc.results).toHaveLength(1);
		expect((doc.results[0] as { text: string }).text).toBe("done");
	});
});

describe("documentId", () => {
	test("is deterministic for the same name", () => {
		expect(documentId("Lasgun")).toBe(documentId("Lasgun"));
	});

	test("differs for different names", () => {
		expect(documentId("Lasgun")).not.toBe(documentId("Boltgun"));
	});

	test("honors an explicit id", () => {
		expect(documentId("Lasgun", "abc123")).toBe("abc123");
	});

	test("is a 16-char Foundry id", () => {
		expect(documentId("Lasgun")).toMatch(/^[A-Za-z0-9]{16}$/);
	});
});
