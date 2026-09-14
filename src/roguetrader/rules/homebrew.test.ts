import { describe, expect, test } from "bun:test";
import {
	CORE_FIRE_MODE_BONUS,
	CORE_PUSH_CAP,
	parseHomebrewProfile,
	resolveFireModeBonus,
	resolvePushCap,
} from "./homebrew";

describe("resolveFireModeBonus (bead 9if pilot)", () => {
	test("core values apply with no profile (Core Rulebook p237: +10/+20)", () => {
		expect(CORE_FIRE_MODE_BONUS).toEqual({ burst: 10, full: 20 });
		expect(resolveFireModeBonus(null, "burst")).toBe(10);
		expect(resolveFireModeBonus(null, "full")).toBe(20);
	});

	test("single/undefined modes never contribute", () => {
		expect(resolveFireModeBonus(null, "single")).toBeNull();
		expect(resolveFireModeBonus(null, undefined)).toBeNull();
	});

	test("homebrew overrides replace core bonuses", () => {
		const profile = { id: "house", fireModeBonus: { burst: 0, full: 10 } };
		expect(resolveFireModeBonus(profile, "burst")).toBe(0);
		expect(resolveFireModeBonus(profile, "full")).toBe(10);
	});

	test("profile without fire-mode data falls back to core", () => {
		expect(resolveFireModeBonus({ id: "house" }, "full")).toBe(20);
	});
});

describe("parseHomebrewProfile", () => {
	test("empty stored values mean core rules", () => {
		expect(parseHomebrewProfile("")).toEqual({ id: "rt-core" });
		expect(parseHomebrewProfile(null)).toEqual({ id: "rt-core" });
		expect(parseHomebrewProfile(undefined)).toEqual({ id: "rt-core" });
	});

	test("JSON profiles parse and pass through", () => {
		const stored = JSON.stringify({
			id: "house",
			fireModeBonus: { burst: 5, full: 15 },
		});
		const profile = parseHomebrewProfile(stored);
		expect(profile.fireModeBonus).toEqual({ burst: 5, full: 15 });
		expect(resolveFireModeBonus(profile, "burst")).toBe(5);
	});

	test("objects pass through directly", () => {
		const profile = { id: "house" };
		expect(parseHomebrewProfile(profile)).toBe(profile);
	});

	test("malformed data falls back to core with a warning", () => {
		expect(parseHomebrewProfile("not json")).toEqual({ id: "rt-core" });
		expect(parseHomebrewProfile("{}")).toEqual({ id: "rt-core" });
	});
});

describe("resolvePushCap (epic 0hap)", () => {
	test("core caps: sanctioned +3, renegades/sorcerers +4 (Table 6-1 p157)", () => {
		expect(CORE_PUSH_CAP).toEqual({ sanctioned: 3, other: 4 });
		expect(resolvePushCap(null, true)).toBe(3);
		expect(resolvePushCap(null, false)).toBe(4);
	});

	test("the homebrew override wins when present", () => {
		const profile = { id: "house", pushCap: { sanctioned: 2, other: 5 } };
		expect(resolvePushCap(profile, true)).toBe(2);
		expect(resolvePushCap(profile, false)).toBe(5);
	});

	test("a malformed cap falls back to core, never below 1", () => {
		const profile = { id: "house", pushCap: { sanctioned: 0, other: Number.NaN } };
		expect(resolvePushCap(profile, true)).toBe(1);
		expect(resolvePushCap(profile, false)).toBe(4);
	});
});