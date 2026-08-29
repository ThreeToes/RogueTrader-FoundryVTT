import { describe, expect, test } from "bun:test";
import {
	bodyLocations,
	EntryRegistry,
	protectionTypes,
	qualities,
} from "../src/roguetrader/registry";

describe("EntryRegistry", () => {
	test("seeds initial entries", () => {
		const reg = new EntryRegistry({
			head: "BODY_LOCATION.HEAD",
			body: "BODY_LOCATION.BODY",
		});
		expect(reg.get("head")).toBe("BODY_LOCATION.HEAD");
		expect(reg.keys()).toHaveLength(2);
	});

	test("register adds and overwrites", () => {
		const reg = new EntryRegistry({});
		reg.register("a", "LABEL.A");
		reg.register("a", "LABEL.A2");
		expect(reg.get("a")).toBe("LABEL.A2");
	});

	test("choices returns a plain object copy", () => {
		const reg = new EntryRegistry({});
		reg.register("k", "K");
		const choices = reg.choices;
		expect(choices).toEqual({ k: "K" });
		// copy, not live reference
		delete (choices as Record<string, string>).k;
		expect(reg.has("k")).toBe(true);
	});

	test("core body locations are registered", () => {
		for (const key of [
			"head",
			"body",
			"left-arm",
			"right-arm",
			"left-leg",
			"right-leg",
		]) {
			expect(bodyLocations.has(key)).toBe(true);
			expect(bodyLocations.get(key)).toMatch(/^BODY_LOCATION\./);
		}
	});

	test("core qualities are registered with localization keys", () => {
		for (const key of qualities.keys()) {
			expect(qualities.get(key)).toMatch(/^QUALITY\./);
		}
		expect(qualities.has("accurate")).toBe(true);
		expect(qualities.has("tearing")).toBe(false);
	});

	test("protection types include primitive and non-primitive", () => {
		expect(protectionTypes.has("primitive")).toBe(true);
		expect(protectionTypes.has("non-primitive")).toBe(true);
	});
});
