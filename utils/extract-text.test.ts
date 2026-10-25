/**
 * Guards for `parsePageSpec` (bead 1tfk): the page-range parser the Core
 * Rulebook dumps are sliced with. A regression here silently extracts the
 * WRONG book pages, and every pack table built from those dumps inherits the
 * fault, so the cases below pin what the function actually does:
 *
 *   - ranges are inclusive and may be written either way round (min/max);
 *   - pages outside 1..pageCount are DROPPED, not clamped;
 *   - a spec that selects no valid page throws loudly;
 *   - malformed fragments collapse to NaN and are dropped with the rest, so
 *     they only fail loudly when nothing else in the spec is valid.
 *
 * `extract-text.ts` is a CLI script guarded by `import.meta.main`, so
 * importing it here has no side effects.
 */
import { describe, expect, test } from "bun:test";
import { parsePageSpec } from "./extract-text";

describe("parsePageSpec", () => {
	test("range plus single page, in order", () => {
		expect(parsePageSpec("3-5,8", 10)).toEqual([3, 4, 5, 8]);
	});

	test("single page", () => {
		expect(parsePageSpec("7", 10)).toEqual([7]);
	});

	test("result is ascending and de-duplicated", () => {
		expect(parsePageSpec("8,3-4,4,3", 10)).toEqual([3, 4, 8]);
	});

	test("whitespace around fragments and bounds is ignored", () => {
		expect(parsePageSpec(" 3 , 5 - 7 ", 10)).toEqual([3, 5, 6, 7]);
	});

	test("reversed range means the same as the ascending form", () => {
		expect(parsePageSpec("5-3", 10)).toEqual([3, 4, 5]);
	});

	test("out-of-range pages are dropped, the rest of the spec survives", () => {
		// 0 and 11 are discarded (not clamped to 1 and 10).
		expect(parsePageSpec("0,3,11", 10)).toEqual([3]);
	});

	test("pages past a short book are dropped", () => {
		expect(parsePageSpec("1,2,3", 2)).toEqual([1, 2]);
	});

	test("a spec selecting only out-of-range pages throws loudly", () => {
		expect(() => parsePageSpec("0,11", 10)).toThrow(/selects no valid pages/);
		expect(() => parsePageSpec("1", 0)).toThrow(/selects no valid pages/);
	});

	test("empty spec throws loudly", () => {
		expect(() => parsePageSpec("", 10)).toThrow(/selects no valid pages/);
		expect(() => parsePageSpec(" , ", 10)).toThrow(/selects no valid pages/);
	});

	test("non-numeric fragments throw loudly", () => {
		expect(() => parsePageSpec("abc", 10)).toThrow(/selects no valid pages/);
		expect(() => parsePageSpec("3.5", 10)).toThrow(/selects no valid pages/);
	});

	test("three-part range is not a range and throws loudly", () => {
		// "3-5-7" is neither a range ("a-b") nor a number -> NaN -> dropped.
		expect(() => parsePageSpec("3-5-7", 10)).toThrow(/selects no valid pages/);
	});

	test('quirk: a missing bound reads as 0, so "5-" means pages 1-5', () => {
		// Pinned as-is (not invented): open-ended specs are unsupported, and
		// Number("") === 0 makes the range 0-5, of which 0 is then dropped.
		// Changing this to a loud failure is a deliberate behaviour change.
		expect(parsePageSpec("5-", 10)).toEqual([1, 2, 3, 4, 5]);
	});
});
