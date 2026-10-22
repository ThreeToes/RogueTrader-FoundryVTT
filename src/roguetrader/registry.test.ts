import { describe, expect, test } from "bun:test";
import {
	afflictionProcedures,
	attachRegistriesToConfig,
	bodyLocations,
	createRegistries,
	damageTypes,
	EntryRegistry,
	madnessEntryKinds,
	ORIGIN_ROW_ORDER,
	ORIGIN_ROWS,
	originRowChoices,
	protectionTypes,
	psychicDisciplines,
	qualities,
	talentCategories,
	talentConditions,
	talents,
	vehicleClasses,
	vehicleFacings,
	vehicleSystems,
	vehicleTraits,
	weaponFamilies,
	XENO_ORIGIN_ROWS,
} from "./registry";

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
		// Widened in bead rss: tearing/primitive/snare/etc. now seeded.
		expect(qualities.has("tearing")).toBe(true);
		expect(qualities.has("primitive")).toBe(true);
		expect(qualities.has("snare")).toBe(true);
	});

	test("protection types include primitive and non-primitive", () => {
		expect(protectionTypes.has("primitive")).toBe(true);
		expect(protectionTypes.has("non-primitive")).toBe(true);
	});

	test("vehicle registries are seeded with localization keys", () => {
		for (const key of vehicleClasses.keys()) {
			expect(vehicleClasses.get(key)).toMatch(/^VEHICLE_CLASS\./);
		}
		for (const facing of ["front", "left", "right", "rear", "top", "bottom"]) {
			expect(vehicleFacings.has(facing)).toBe(true);
			expect(vehicleFacings.get(facing)).toMatch(/^VEHICLE_FACING\./);
		}
		for (const key of vehicleTraits.keys()) {
			expect(vehicleTraits.get(key)).toMatch(/^VEHICLE_TRAIT\./);
		}
		for (const key of vehicleSystems.keys()) {
			expect(vehicleSystems.get(key)).toMatch(/^VEHICLE_SYSTEM\./);
		}
	});

	test("damage types are seeded from the domain enum (bead seeg)", () => {
		// The keys are the STORED enum values (the sheets read them back for
		// display); the labels are the DAMAGE_TYPE.* i18n keys.
		expect(damageTypes.choices).toEqual({
			Energy: "DAMAGE_TYPE.ENERGY",
			Explosive: "DAMAGE_TYPE.EXPLOSIVE",
			Impact: "DAMAGE_TYPE.IMPACT",
			Rending: "DAMAGE_TYPE.RENDING",
		});
	});

	test("madness entry kinds are seeded (bead b76m)", () => {
		for (const key of madnessEntryKinds.keys()) {
			expect(madnessEntryKinds.get(key)).toMatch(/^MADNESS\.KIND_/);
		}
		// Track rows + malignancies + the afflictions pack's reference-table
		// kinds (fear difficulties, phenomena, perils, shock results).
		expect(madnessEntryKinds.keys()).toHaveLength(10);
		expect(madnessEntryKinds.choices).toHaveProperty("insanity-track");
		expect(madnessEntryKinds.choices).toHaveProperty("shock-table");
	});

	test("weapon families are seeded with localization keys (bead erzk)", () => {
		for (const key of weaponFamilies.keys()) {
			expect(weaponFamilies.get(key)).toMatch(/^WEAPON_FAMILY\./);
		}
		// The book's training families must all be present (printed p272:
		// the Weapon Training gate resolves against these).
		expect(weaponFamilies.choices).toHaveProperty("las");
		expect(weaponFamilies.choices).toHaveProperty("sp");
		expect(weaponFamilies.choices).toHaveProperty("primitive");
	});

	test("psychic disciplines are seeded with localization keys (hkc5)", () => {
		for (const key of psychicDisciplines.keys()) {
			expect(psychicDisciplines.get(key)).toMatch(/^PSYCHIC_DISCIPLINE\./);
		}
		// Core Rulebook p159: the three base disciplines; bead hkc5 adds the
		// Navis Primer/Into the Storm disciplines (theosophamy, voidfrost,
		// soul-ward).
		expect(psychicDisciplines.keys()).toHaveLength(7);
		expect(psychicDisciplines.choices).toHaveProperty("theosophamy");
		expect(psychicDisciplines.choices).toHaveProperty("voidfrost");
		expect(psychicDisciplines.choices).toHaveProperty("soul-ward");
		expect(psychicDisciplines.choices).toHaveProperty("waaagh");
	});

	test("talent registries are seeded with localization keys", () => {
		expect(talents.has("frenzy")).toBe(true);
		for (const key of talents.keys()) {
			expect(talents.get(key)).toMatch(/^TALENT\./);
		}
		for (const key of talentCategories.keys()) {
			expect(talentCategories.get(key)).toMatch(/^TALENT_CATEGORY\./);
		}
	});
});

describe("Origin Path row vocabulary (bead rhua)", () => {
	// Bead rhua: the chart row vocabulary moved here from rules/origins.ts so
	// the `row` DataModel field (data/item/origin.ts) sources its schema enums
	// from the data seam like every sibling model, not from the rules layer.
	// The pack-entries coverage ("covers every row the pack actually uses")
	// stays in rules/origins.test.ts, which now exercises the re-export.
	test("ORIGIN_ROW_ORDER carries the whole chart vocabulary", () => {
		expect(ORIGIN_ROW_ORDER).toEqual([
			"home-world",
			"birthright",
			"lure",
			"trials",
			"motivation",
			"lineage",
			"kindred",
			"klan",
			"know-wotz",
			"competence",
		]);
		// Human rows stay exactly the six documented ones (ITS p28 Lineage) and
		// the xeno rows are APPENDED, never substituted (2026-09-20 containment).
		expect(ORIGIN_ROWS).toHaveLength(6);
		expect(XENO_ORIGIN_ROWS).toHaveLength(4);
	});

	test("originRowChoices covers every ordered row", () => {
		const choices = originRowChoices();
		expect(Object.keys(choices)).toEqual(ORIGIN_ROW_ORDER);
		for (const row of ORIGIN_ROW_ORDER) {
			expect(choices[row], row).toBe(row);
		}
	});
});

describe("registry factory (bead hazf)", () => {
	test("talentConditions and afflictionProcedures are seeded", () => {
		// Bead hazf: these registries existed but were never attached to
		// CONFIG; now they ride the seed table with everything else.
		expect(talentConditions.has("charging")).toBe(true);
		expect(talentConditions.get("charging")).toMatch(/^CONDITION\./);
		expect(afflictionProcedures.has("degenerate-mind")).toBe(true);
		expect(afflictionProcedures.get("degenerate-mind")).toMatch(/^PROCEDURE\./);
	});

	test("createRegistries builds one EntryRegistry per seed entry", () => {
		const set = createRegistries(
			{ things: { a: "THING.A" }, moods: { b: "MOOD.B" } },
			"NO_CONFIG_HERE",
		);
		expect(set.things).toBeInstanceOf(EntryRegistry);
		expect(set.things.get("a")).toBe("THING.A");
		expect(set.moods.choices).toEqual({ b: "MOOD.B" });
	});

	test("createRegistries attaches under a custom CONFIG namespace", () => {
		const g = globalThis as unknown as {
			CONFIG?: Record<string, Record<string, unknown>>;
		};
		g.CONFIG = {};
		const set = createRegistries(
			{ qualities: { overload: "QUALITY.OVERLOAD" } },
			"MY_SYSTEM",
		);
		expect(g.CONFIG.MY_SYSTEM?.qualities).toBe(set.qualities);
		// And a module can extend it through the namespace.
		(set.qualities as EntryRegistry).register("extra", "QUALITY.EXTRA");
		expect((g.CONFIG.MY_SYSTEM!.qualities as EntryRegistry).has("extra")).toBe(
			true,
		);
		delete g.CONFIG;
	});

	test("attachRegistriesToConfig attaches the RT set incl. conditions", () => {
		const g = globalThis as unknown as {
			CONFIG?: Record<string, Record<string, unknown>>;
		};
		g.CONFIG = {};
		attachRegistriesToConfig();
		const rt = g.CONFIG.ROGUE_TRADER!;
		expect(rt.qualities).toBe(qualities);
		expect(rt.talentConditions).toBe(talentConditions);
		expect(rt.afflictionProcedures).toBe(afflictionProcedures);
		expect(rt.careers).toBeDefined();
		delete g.CONFIG;
	});
});
