import { describe, expect, test } from "bun:test";
import { breakdown, mergeModifiers } from "./funnel";

describe("mergeModifiers", () => {
	test("deduplicates by id, first wins", () => {
		const a = [
			{
				id: "aim",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 10,
			},
		];
		const b = [
			{
				id: "aim",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 20,
			},
			{
				id: "wound",
				source: { type: "effect" as const, label: "e" },
				label: "Wound",
				value: -10,
			},
		];
		const merged = mergeModifiers(a, b);
		expect(merged).toHaveLength(2);
		expect(merged[0].value).toBe(10);
	});
});

describe("breakdown", () => {
	test("produces ordered label/value pairs", () => {
		const rows = breakdown([
			{
				id: "a",
				source: { type: "dialog" as const, label: "d" },
				label: "Aim",
				value: 10,
			},
			{
				id: "b",
				source: { type: "effect" as const, label: "e" },
				label: "Wound",
				value: -10,
			},
		]);
		expect(rows).toEqual([
			{ label: "Aim", value: 10 },
			{ label: "Wound", value: -10 },
		]);
	});
});
