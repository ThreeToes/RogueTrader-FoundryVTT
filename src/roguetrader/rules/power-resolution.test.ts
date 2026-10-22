import { describe, expect, test } from "bun:test";
import {
	powerResolutionKeys,
	registerPowerSubtype,
	resolvePower,
} from "./power-resolution";

describe("power-resolution registry (bead sa6)", () => {
	test("built-in subtypes resolve", () => {
		expect(resolvePower("focus")).toEqual({ damage: false, sustained: false });
		expect(resolvePower("bolt")).toEqual({ damage: true, sustained: false });
		expect(resolvePower("zone")).toEqual({ damage: true, sustained: false });
	});

	test("unknown subtypes fall back to prose (display-only, never crash)", () => {
		expect(resolvePower("weird-custom")).toEqual({
			damage: false,
			sustained: false,
		});
		expect(resolvePower(undefined)).toEqual({
			damage: false,
			sustained: false,
		});
	});

	test("registerPowerSubtype resolves and does not mutate the stored entry", () => {
		registerPowerSubtype("custom-drain", { damage: false, sustained: true });
		// Registered BEFORE any schema build (the init rule): the vocabulary
		// key and its resolution are one registration (bead ilpz).
		expect(powerResolutionKeys()).toContain("custom-drain");
		expect(resolvePower("custom-drain")).toEqual({
			damage: false,
			sustained: true,
		});
		const resolved = resolvePower("custom-drain");
		resolved.damage = true;
		// resolvePower hands out copies; mutating one result cannot corrupt
		// the registry entry the schema choices still point at.
		expect(resolvePower("custom-drain").damage).toBe(false);
	});
});