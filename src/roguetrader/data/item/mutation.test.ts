import { describe, expect, test } from "bun:test";
import { rollMutation, rollRavagedBody } from "./mutation-roll";

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

describe("rollRavagedBody (bead kam1)", () => {
	const table = [
		{ tableKey: "mutations", rollMin: 1, rollMax: 50, name: "Grotesque" },
		{ tableKey: "mutations", rollMin: 51, rollMax: 100, name: "Hellspawn" },
		{ tableKey: "navigator-mutations", rollMin: 1, rollMax: 100, name: "Unused" },
	];

	test("1d5 count then one d100 per mutation, keeping the dice", async () => {
		const rolls = [2, 10, 80];
		let i = 0;
		const out = await rollRavagedBody(table, async () => rolls[i++] ?? 0);
		expect(out).toEqual([
			{ roll: 10, name: "Grotesque" },
			{ roll: 80, name: "Hellspawn" },
		]);
	});

	test("reads the mutations table, not the Navigator set", async () => {
		const rolls = [1, 100];
		let i = 0;
		const out = await rollRavagedBody(table, async () => rolls[i++] ?? 0);
		expect(out).toEqual([{ roll: 100, name: "Hellspawn" }]);
	});

	test("an out-of-range count throws", async () => {
		await expect(rollRavagedBody(table, async () => 6)).rejects.toThrow(
			/out of range/,
		);
	});

	test("a d100 with no covering row throws", async () => {
		const rolls = [1, 0];
		let i = 0;
		await expect(
			rollRavagedBody(table, async () => rolls[i++] ?? 0),
		).rejects.toThrow(/no covering row/);
	});
});
