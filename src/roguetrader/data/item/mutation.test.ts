import { describe, expect, test } from "bun:test";
import { rollMutation } from "./mutation-roll";

const rows = [
	{ tableKey: "mutations", rollMin: 1, rollMax: 5, name: "Grotesque" },
	{ tableKey: "mutations", rollMin: 6, rollMax: 10, name: "Tough Hide" },
	{ tableKey: "mutations", rollMin: 100, rollMax: 100, name: "Hellspawn" },
	{ tableKey: "navigator-mutations", rollMin: 1, rollMax: 100, name: "Unused" },
];

describe("rollMutation (bead bfdz)", () => {
	test("d100 roll resolves the covering row", () => {
		expect(rollMutation(rows, "mutations", 3)?.name).toBe("Grotesque");
		expect(rollMutation(rows, "mutations", 7)?.name).toBe("Tough Hide");
		expect(rollMutation(rows, "mutations", 100)?.name).toBe("Hellspawn");
	});

	test("tableKey isolates the Navigator set", () => {
		expect(rollMutation(rows, "navigator-mutations", 50)?.name).toBe("Unused");
	});

	test("no covering row yields null (loud caller handling)", () => {
		expect(rollMutation(rows.filter((r) => r.tableKey === "navigator-mutations"), "mutations", 50)).toBeNull();
	});
});
