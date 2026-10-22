import { describe, expect, test } from "bun:test";
import { HandlerRegistry, Registry } from "./registry";

// Bead 00z5: append-only global handler registries grew no removal path, so
// every suite that registered a handler leaked it into the next suite in the
// same process (bun runs all files in ONE process). These tests pin the fix:
// reference de-dupe on `on`, plus `off`/`clear` teardown.

describe("HandlerRegistry (bead 00z5)", () => {
	test("on de-duplicates a reference-identical handler", () => {
		const registry = new HandlerRegistry<string, () => number>();
		const handler = () => 1;
		registry.on("k", handler).on("k", handler);
		// A different handler is still appended beside it, in order.
		registry.on("k", () => 2);
		expect([...registry.for("k")]).toHaveLength(2);
		expect([...registry.for("k")].filter((fn) => fn === handler)).toHaveLength(
			1,
		);
	});

	test("off removes one handler and true/false mirrors presence", () => {
		const registry = new HandlerRegistry<string, () => number>();
		const a = () => 1;
		const b = () => 2;
		registry.on("k", a).on("k", b);
		expect(registry.off("k", a)).toBe(true);
		expect([...registry.for("k")]).toEqual([b]);
		// Removing an absent or never-registered handler is a quiet no-op.
		expect(registry.off("k", a)).toBe(false);
		expect(registry.off("missing", a)).toBe(false);
	});

	test("off of the last handler empties the key from the keys list", () => {
		const registry = new HandlerRegistry<string, () => number>();
		registry.on("k", () => 1);
		registry.off("k", registry.for("k")[0]);
		expect(registry.keys()).toEqual([]);
		expect(registry.for("k")).toEqual([]);
		expect(registry.all()).toEqual([]);
	});

	test("clear(key) drops one key, clear() drops everything", () => {
		const registry = new HandlerRegistry<string, () => number>();
		registry.on("a", () => 1).on("b", () => 2);
		registry.clear("a");
		expect(registry.keys()).toEqual(["b"]);
		registry.clear();
		expect(registry.keys()).toEqual([]);
	});

	// The leakage proof (bead 00z5): registration teardown restores the exact
	// pre-registration state, so a suite's handlers cannot cross-contaminate
	// a later suite sharing the singleton in the same process.
	test("off restores the pre-registration state — no cross-suite leakage", () => {
		const registry = new HandlerRegistry<string, () => number>();
		const before = [...registry.all()];
		const handler = () => 1;
		registry.on("suite-owned", handler);
		expect(registry.for("suite-owned")).toHaveLength(1);
		registry.off("suite-owned", handler);
		expect(registry.keys()).toEqual([]);
		expect([...registry.all()]).toEqual(before);
	});
});

describe("Registry (regression: untouched register/replace semantics)", () => {
	test("register still replaces rather than de-duplicates", () => {
		const registry = new Registry<number>();
		registry.register("k", 1).register("k", 2);
		expect(registry.get("k")).toBe(2);
		expect(registry.size).toBe(1);
	});
});