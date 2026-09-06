import { describe, expect, test } from "bun:test";
import {
	deriveShipStats,
	parsePowerDraw,
	parsePowerGenerated,
	parseSpToken,
	parseWeaponCapacity,
	validateWeaponSlots,
	voidShieldsGranted,
	WEAPON_SLOTS,
} from "./ship-systems";

// Bead om4j: starship model round 2 (Core Rulebook Ch. VIII).
// Drives generate ("35 Generated", Table 8-3 book p201), other components
// draw; SP tokens per Table 8-8 (book p207); void shields per Table 8-3
// (Single = 1, Multiple = 2, book p201); capacity slots per Table 8-4
// (book p202, "Dorsal/Prow/Port/Starboard", broadsides Port/Starboard only).

describe("power parsing (Table 8-3, book p201)", () => {
	test("drives generate", () => {
		expect(parsePowerGenerated("35 Generated")).toBe(35);
		expect(parsePowerGenerated("40 generated")).toBe(40);
		expect(parsePowerGenerated("5")).toBe(0);
		expect(parsePowerGenerated("-")).toBe(0);
	});
	test("other components draw", () => {
		expect(parsePowerDraw("5")).toBe(5);
		expect(parsePowerDraw("35 Generated")).toBe(0);
		expect(parsePowerDraw("-")).toBe(0);
		expect(parsePowerDraw("")).toBe(0);
	});
});

describe("SP tokens (Table 8-8, book p207)", () => {
	test("parses '-', '+N' and 'N' forms", () => {
		expect(parseSpToken("-")).toBe(0);
		expect(parseSpToken("")).toBe(0);
		expect(parseSpToken("+1")).toBe(1);
		expect(parseSpToken("+2")).toBe(2);
		expect(parseSpToken("1")).toBe(1);
		expect(parseSpToken("3")).toBe(3);
	});
});

describe("void shields (Table 8-3, book p201)", () => {
	test("Single = 1, Multiple = 2, others 0", () => {
		expect(voidShieldsGranted("Single Void Shield Array")).toBe(1);
		expect(voidShieldsGranted("Multiple Void Shield Array")).toBe(2);
		expect(voidShieldsGranted("Jovian Pattern Class 1 Drive")).toBe(0);
	});
});

describe("weapon capacity parsing (Table 8-4, book p202)", () => {
	test("handles both verbatim statline forms", () => {
		expect(parseWeaponCapacity("1 Prow, 1 Port, 1 Starboard")).toEqual({
			prow: 1,
			port: 1,
			starboard: 1,
		});
		expect(parseWeaponCapacity("Dorsal 1, Prow 1")).toEqual({
			dorsal: 1,
			prow: 1,
		});
		expect(parseWeaponCapacity("Dorsal 2")).toEqual({ dorsal: 2 });
		expect(parseWeaponCapacity("")).toEqual({});
	});
});

describe("deriveShipStats (bead om4j)", () => {
	test("sums generation, draw, space, SP and shields", () => {
		const stats = deriveShipStats([
			{ name: "Jovian Pattern Class 1 Drive", power: "35 Generated", space: 8, sp: "-" },
			{ name: "Single Void Shield Array", power: "5", space: 1, sp: "-" },
			{ name: "Mars Pattern Macrocannons", power: "4", space: 2, sp: "1" },
			{ name: "Commerce Bridge", power: "1", space: 2, sp: "0" },
		]);
		expect(stats.powerGenerated).toBe(35);
		expect(stats.powerUsed).toBe(10);
		expect(stats.powerDeficit).toBe(0);
		expect(stats.spaceUsed).toBe(13);
		expect(stats.spSpent).toBe(1);
		expect(stats.voidShieldsMax).toBe(1);
	});

	test("deficit when draw exceeds generation (book p198-199)", () => {
		const stats = deriveShipStats([
			{ name: "Small Drive", power: "5 Generated", space: 1, sp: "-" },
			{ name: "Hungry Component", power: "8", space: 1, sp: "-" },
		]);
		expect(stats.powerDeficit).toBe(3);
	});
});

describe("weapon slot validation (bead om4j, loud failures)", () => {
	const capacity = "1 Prow, 2 Port, 1 Starboard";
	const w = (name: string, slot: string, special = "") => ({
		name,
		power: "4",
		space: 2,
		sp: "1",
		slot,
		special,
	});

	test("unassigned slots are flagged", () => {
		const issues = validateWeaponSlots(capacity, [w("Mars", "")]);
		expect(issues).toEqual([{ name: "Mars", kind: "unassigned" }]);
	});

	test("slots the hull lacks are flagged", () => {
		const issues = validateWeaponSlots(capacity, [w("Mars", "dorsal")]);
		expect(issues[0].kind).toBe("unknown-slot");
	});

	test("broadsides must take Port or Starboard (Table 8-4)", () => {
		const broadside = w(
			"Mars Pattern Macrocannon Broadside",
			"prow",
			"Broadside: must occupy Port or Starboard.",
		);
		expect(validateWeaponSlots(capacity, [broadside])[0].kind).toBe(
			"broadside-slot",
		);
		const ok = { ...broadside, slot: "port" };
		expect(validateWeaponSlots(capacity, [ok])).toEqual([]);
	});

	test("over-capacity is flagged per slot", () => {
		const issues = validateWeaponSlots(capacity, [
			w("A", "port"),
			w("B", "port"),
			w("C", "port"),
		]);
		expect(issues).toEqual([
			{ name: "port", kind: "over-capacity", slot: "port" },
		]);
	});

	test("valid load passes clean", () => {
		expect(
			validateWeaponSlots(capacity, [
				w("A", "prow"),
				w("B", "port"),
				w("C", "port"),
				w("D", "starboard"),
			]),
		).toEqual([]);
	});

	test("slot vocabulary is the Table 8-4 set", () => {
		expect(WEAPON_SLOTS).toEqual(["dorsal", "prow", "port", "starboard"]);
	});
});