import { describe, expect, test } from "bun:test";
import {
	finalCharacteristics,
	isUnresolvedChoice,
	matchOriginSkills,
	POINT_BUY_BUDGET,
	POINT_BUY_MAX,
	validatePointBuy,
	woundsFromOrigin,
	type CatalogSkill,
	type ResolvedOrigin,
} from "./creation";

describe("validatePointBuy (rt_core p14)", () => {
	test("empty allocation is valid with the full budget remaining", () => {
		const result = validatePointBuy({});
		expect(result.total).toBe(0);
		expect(result.remaining).toBe(POINT_BUY_BUDGET);
		expect(result.valid).toBe(true);
	});

	test("budget spread across characteristics is valid", () => {
		const result = validatePointBuy({
			ws: 10, bs: 10, s: 10, t: 10,
			ag: 10, int: 10, per: 10, wp: 10, fel: 20,
		});
		expect(result.total).toBe(100);
		expect(result.remaining).toBe(0);
		expect(result.valid).toBe(true);
	});

	test("over-budget allocation is invalid", () => {
		const result = validatePointBuy({
			ws: 20, bs: 20, s: 20, t: 20,
			ag: 10, int: 10, per: 10, wp: 10, fel: 10,
		});
		expect(result.total).toBe(130);
		expect(result.valid).toBe(false);
	});

	test("over-cap characteristic is flagged", () => {
		const result = validatePointBuy({ ws: POINT_BUY_MAX + 1, t: 20 });
		expect(result.overCap).toEqual(["ws"]);
		expect(result.valid).toBe(false);
	});
});

describe("finalCharacteristics", () => {
	test("applies origin deltas and clamps to 0-100", () => {
		const base = { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 };
		const result = finalCharacteristics(base, { wp: 5, fel: -5, t: 75 });
		expect(result.wp).toBe(35);
		expect(result.fel).toBe(25);
		expect(result.t).toBe(100);
	});
});

describe("woundsFromOrigin (p17-24 home world sections)", () => {
	test("double TB plus dice totals plus flat bonus", () => {
		// Death world: 2xTB + 1d5+2 (rolled 5) => TB 3 -> 6+5+2 = 13.
		expect(woundsFromOrigin(3, [7], 0)).toBe(13);
		// Endurance motivation adds +1 wound.
		expect(woundsFromOrigin(3, [7], 1)).toBe(14);
		// Void born 1d5 rolled 1: 2*TB + 1.
		expect(woundsFromOrigin(4, [1], 0)).toBe(9);
	});
});

describe("matchOriginSkills", () => {
	const catalog: CatalogSkill[] = [
		{ name: "Survival", characteristic: "int" },
		{ name: "Forbidden Lore", characteristic: "int" },
		{ name: "Speak Language (Low Gothic)", characteristic: "int" },
		{ name: "Tech-Use", characteristic: "int" },
	];

	const resolved = (skills: string[], options: string[] = []): ResolvedOrigin =>
		({
			skills,
			options,
			characteristics: {},
			talents: [],
			woundsDice: [],
			woundBonus: 0,
			fateTable: null,
			fateDelta: 0,
			insanity: 0,
			insanityDice: [],
			corruption: 0,
			corruptionDice: [],
			corruptionOrInsanityDice: [],
			initiativeBonus: 0,
			profitFactor: 0,
			notes: [],
		}) as unknown as ResolvedOrigin;

	test("exact catalog names grant with catalog characteristics", () => {
		const { grants, unmatched } = matchOriginSkills(
			resolved(["Survival", "Tech-Use"]),
			catalog,
		);
		expect(grants).toHaveLength(2);
		expect(grants[0]).toEqual({
			name: "Survival",
			type: "skill",
			system: { characteristic: "int", ladder: 1 },
		});
		expect(unmatched).toHaveLength(0);
	});

	test("specialization form clones the base skill's characteristic", () => {
		const { grants, unmatched } = matchOriginSkills(
			resolved(["Speak Language (Ship Dialect)"]),
			catalog,
		);
		expect(grants).toHaveLength(1);
		expect(grants[0]?.name).toBe("Speak Language (Ship Dialect)");
		expect(grants[0]?.system.characteristic).toBe("int");
		expect(unmatched).toHaveLength(0);
	});

	test("unknown names land in unmatched, never silently dropped", () => {
		const { unmatched } = matchOriginSkills(
			resolved(["Common Lore (Machine Cult)"]),
			catalog,
		);
		expect(unmatched).toEqual(["Common Lore (Machine Cult)"]);
	});

	test("options are matched too", () => {
		const { grants } = matchOriginSkills(resolved([], ["Survival"]), catalog);
		expect(grants).toHaveLength(1);
	});
});

describe("isUnresolvedChoice", () => {
	test("flags 'choose one' placeholders", () => {
		expect(isUnresolvedChoice("Forbidden Lore (choose one)")).toBe(true);
		expect(isUnresolvedChoice("Hatred (choose one)")).toBe(true);
		expect(isUnresolvedChoice("Peer (Underworld)")).toBe(false);
	});
});