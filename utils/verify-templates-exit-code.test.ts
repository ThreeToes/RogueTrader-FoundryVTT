/**
 * Pins the QA gate at the bottom of utils/verify-templates.mjs (bead isru).
 *
 * Regression: the script's pass/fail counter was refactored from a number
 * into a TemplateFailure[] and the exit guard kept its numeric shape
 * (`failures > 0`), which coerces the array via its joined string — `[] > 0`
 * is false, so the script exited 0 with failures printed. A regression pin
 * here cannot drive the wiring (top-level awaits walk the repo), so it pins
 * the guard's shape instead: the gate must read the failure COUNT and exit
 * non-zero on it, never coerce the array itself.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("verify-templates.mjs exits non-zero on failures.length, not on a coerced array", () => {
	const source = readFileSync("utils/verify-templates.mjs", "utf8");
	const gate = source
		.split("\n")
		.filter((line) => line.includes("process.exit(1)"));
	expect(gate.length).toBe(1);
	expect(gate[0]).toContain("failures.length > 0");
	expect(gate[0]).not.toMatch(/\bfailures > 0\b/);
});