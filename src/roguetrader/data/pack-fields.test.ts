/**
 * Pack-field readers (epic kof0, bead ptra).
 *
 * These replaced ~23 inline `String(s.x ?? "")` / `Number(s.y ?? 0)` coercions
 * across the ready-time warmers, so the edge behaviour they encode is worth
 * pinning: it is the difference between a missing pack field becoming a sane
 * default and becoming `"undefined"` or `NaN` in a runtime pool.
 */

import { describe, expect, test } from "bun:test";
import {
	firstStr,
	nested,
	num,
	optionalStr,
	packSystem,
	str,
	strArray,
} from "./pack-fields";

describe("pack-fields (bead ptra)", () => {
	test("packSystem tolerates a missing or non-object system block", () => {
		expect(packSystem({ system: { a: 1 } })).toEqual({ a: 1 });
		expect(packSystem({})).toEqual({});
		expect(packSystem({ system: undefined })).toEqual({});
	});

	test("nested returns an empty record for an absent or non-object field", () => {
		expect(nested({ range: { low: 1 } }, "range")).toEqual({ low: 1 });
		expect(nested({}, "range")).toEqual({});
		expect(nested({ range: "nonsense" }, "range")).toEqual({});
		expect(nested({ range: null }, "range")).toEqual({});
	});

	test("str stringifies and falls back on absent/null", () => {
		expect(str({ k: "v" }, "k")).toBe("v");
		expect(str({ k: 7 }, "k")).toBe("7");
		expect(str({}, "k")).toBe("");
		expect(str({ k: null }, "k")).toBe("");
		expect(str({}, "k", "fallback")).toBe("fallback");
		// An empty string is a value, not an absence — `??` semantics.
		expect(str({ k: "" }, "k", "fallback")).toBe("");
	});

	test("num falls back on absent or unparseable, and keeps 0", () => {
		expect(num({ k: 3 }, "k")).toBe(3);
		expect(num({ k: "4" }, "k")).toBe(4);
		expect(num({}, "k")).toBe(0);
		expect(num({ k: "abc" }, "k", 999)).toBe(999);
		expect(num({ k: 0 }, "k", 999)).toBe(0);
	});

	test("optionalStr collapses absent AND empty to undefined", () => {
		expect(optionalStr({ k: "v" }, "k")).toBe("v");
		expect(optionalStr({}, "k")).toBeUndefined();
		expect(optionalStr({ k: null }, "k")).toBeUndefined();
		expect(optionalStr({ k: "" }, "k")).toBeUndefined();
	});

	test("strArray maps a real array and rejects a non-array", () => {
		expect(strArray({ k: ["a", "b"] }, "k")).toEqual(["a", "b"]);
		expect(strArray({ k: [1, 2] }, "k")).toEqual(["1", "2"]);
		expect(strArray({}, "k")).toEqual([]);
		expect(strArray({ k: "not an array" }, "k")).toEqual([]);
	});

	test("firstStr is the ?? chain, so an empty string wins over a later key", () => {
		expect(firstStr({ a: "A", b: "B" }, "a", "b")).toBe("A");
		expect(firstStr({ b: "B" }, "a", "b")).toBe("B");
		expect(firstStr({}, "a", "b")).toBe("");
		expect(firstStr({ a: null, b: "B" }, "a", "b")).toBe("B");
		// The distinction that matters: `??` keeps "", so firstStr does too.
		expect(firstStr({ a: "", b: "B" }, "a", "b")).toBe("");
		expect(optionalStr({ a: "" }, "a")).toBeUndefined();
	});
});
