import { describe, expect, test } from "bun:test";
import {
	componentHullAllows,
	deriveShipStats,
	hullClassMatches,
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
			{
				name: "Jovian Pattern Class 1 Drive",
				power: "35 Generated",
				space: 8,
				sp: "-",
			},
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
		// Keel added (bead gjn6, book p220): "Dorsal, Prow, Port, Starboard, or
		// Keel" — Wayfarer Station carries a Keel capacity (p210).
		expect(WEAPON_SLOTS).toEqual([
			"dorsal",
			"prow",
			"port",
			"starboard",
			"keel",
		]);
	});
});

// ---------------------------------------------------------------------------
// Hull-class matching + hull-level component exceptions (bead qaro)
// ---------------------------------------------------------------------------

describe("hullClassMatches (whole-token discipline, bead 9cre)", () => {
	test("verbatim token families match, cross-class does not", () => {
		expect(hullClassMatches("Light Cruisers, Cruisers", "light cruiser")).toBe(
			true,
		);
		// Whole-token matching keeps cruiser-sized gear off a light cruiser.
		expect(hullClassMatches("Cruisers", "light cruiser")).toBe(false);
		expect(hullClassMatches("Transports, Raiders, Frigates", "frigate")).toBe(
			true,
		);
		expect(hullClassMatches("Ork Raiders, Frigates (Onslaught-class)", "frigate")).toBe(true);
		expect(hullClassMatches("All Ships", "cruiser")).toBe(true);
	});

	test("extraTokens OR in additional allowance with the same discipline", () => {
		expect(hullClassMatches("Cruisers", "light cruiser", "cruisers")).toBe(
			true,
		);
		// An extra allowance the component's tokens don't cover does nothing.
		expect(hullClassMatches("Cruisers", "transport", "frigates")).toBe(false);
		// raider hull whose book rule grants cruiser-only gear: "Cruisers"
		// DOES match (that is what the extra token is for).
		expect(hullClassMatches("Cruisers", "raider", "cruisers")).toBe(true);
		// Prefix discipline holds for extra tokens too: a qualified component
		// token covers the extra class.
		expect(
			hullClassMatches(
				"Frigates (Onslaught-class)",
				"light cruiser",
				"frigates",
			),
		).toBe(true);
		expect(hullClassMatches("Cruisers", "frigate", "")).toBe(false);
	});
});

describe("componentHullAllows (bead qaro, Secutor exception)", () => {
	const repulsor = { hullTypes: "Cruisers", type: "void-shield" };
	// Secutor-class monitor-cruiser hull (Into the Storm p152): hullClass
	// "light cruiser", book rule "Outfitted for war" lets it use 'cruiser
	// only' Void Shield Components.
	const secutorClass = "light cruiser";
	const secutorExtras = "void-shield:cruisers";

	test("void shields are offered on the Secutor (book p152)", () => {
		expect(
			componentHullAllows(
				repulsor.hullTypes,
				secutorClass,
				repulsor.type,
				secutorExtras,
			),
		).toBe(true);
	});

	test("the exception is scoped: a macrobattery does NOT match", () => {
		expect(
			componentHullAllows(
				"Cruisers",
				secutorClass,
				"macrobattery",
				secutorExtras,
			),
		).toBe(false);
	});

	test("multiple comma-separated scoped entries each honour their scope", () => {
		const extras = "void-shield:cruisers, lance:battlecruisers, raiders";
		expect(componentHullAllows("Cruisers", secutorClass, "void-shield", extras)).toBe(true);
		// battlecruiser maps to the cruiser token family; "raiders" is bare
		// (all component types).
		expect(componentHullAllows("Battlecruisers", secutorClass, "lance", extras)).toBe(true);
		expect(componentHullAllows("Raiders", secutorClass, "macrobattery", extras)).toBe(true);
		expect(componentHullAllows("Cruisers", secutorClass, "lance", extras)).toBe(false);
	});

	test("bare (unscoped) entries apply to every component type", () => {
		expect(componentHullAllows("Cruisers", secutorClass, "macrobattery", "cruisers")).toBe(true);
	});

	test("scoped entries never fire for an unknown component type", () => {
		expect(componentHullAllows("Cruisers", secutorClass, undefined, secutorExtras)).toBe(false);
		expect(componentHullAllows("Cruisers", secutorClass, undefined, "cruisers")).toBe(true);
	});

	test("empty / missing extraHullTypes behaves as the plain match", () => {
		expect(componentHullAllows("Cruisers", secutorClass, "void-shield", "")).toBe(false);
		expect(componentHullAllows("Cruisers", secutorClass, "void-shield", "  ")).toBe(false);
		// The plain match path is untouched by the extra parsing.
		expect(componentHullAllows("Light Cruisers, Cruisers", secutorClass, "void-shield", "")).toBe(true);
	});
});
