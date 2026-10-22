import { describe, expect, test } from "bun:test";
import type { Modifier } from "../../rules-engine/modifier";
import { mergeModifiers } from "./funnel";

// mergeModifiers' semantics, pinned here after bead poq3 moved them out of the
// domain effect suite (a domain test file may not import the application
// layer, and the architecture scanner now covers test files).

const mod = (id: string, value: number): Modifier => ({
	id,
	source: { type: "item", label: "Medikit" },
	label: "Medikit",
	value,
});

describe("mergeModifiers (funnel, bead poq3)", () => {
	test("first-wins dedupe by id: duplicate ids collapse to one row", () => {
		const merged = mergeModifiers(
			[mod("talent:one:any:Medikit:any", 5), mod("talent:one:any:Medikit:any", 5)],
			[],
		);
		expect(merged).toHaveLength(1);
	});

	test("distinct ids are kept and sum (bead 2040)", () => {
		const merged = mergeModifiers(
			[mod("talent:a:any:Medikit:any", 5), mod("talent:b:any:Medikit:any", 5)],
			[],
		);
		expect(merged).toHaveLength(2);
		expect(merged.reduce((sum, m) => sum + m.value, 0)).toBe(10);
	});

	test("the second batch dedupes against the first (caller extras take precedence)", () => {
		const merged = mergeModifiers(
			[mod("effect:cover", -10)],
			[mod("effect:cover", -10), mod("talent:a:any:Medikit:any", 5)],
		);
		expect(merged).toHaveLength(2);
		expect(merged[0]?.id).toBe("effect:cover");
		expect(merged[1]?.id).toBe("talent:a:any:Medikit:any");
	});
});