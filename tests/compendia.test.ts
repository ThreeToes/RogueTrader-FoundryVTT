import { describe, expect, test } from "bun:test";
import { documentId, resolveEntryType } from "../utils/compendia";

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
