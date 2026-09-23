// Unit tests for the shared actor-sheet view models (bead v2ll).
import { describe, expect, test } from "bun:test";
import { armourLocations, weaponRows } from "./view-models";

const weapon = (overrides: Record<string, unknown> = {}) => ({
	id: "w1",
	name: "Sword",
	type: "melee-weapon",
	system: { class: "melee", damage: "1d10", penetration: 2, clip: 0 },
	...overrides,
});

describe("weaponRows", () => {
	test("builds the shared combat row", () => {
		const rows = weaponRows([weapon({})]);
		expect(rows).toEqual([
			{
				id: "w1",
				name: "Sword",
				classLabel: "CLASS.MELEE",
				damage: "1d10",
				penetration: 2,
				isRanged: false,
				rof: { singleShot: "\u2013", burst: "\u2013", fullAuto: "\u2013" },
				clip: 0,
			},
		]);
	});

	test("ranged weapons carry the S rof marker and clip", () => {
		const rows = weaponRows([
			weapon({
				type: "ranged-weapon",
				system: {
					class: "ranged",
					damage: "1d10",
					penetration: 2,
					clip: 12,
					rateOfFire: { singleShot: true, burst: "3", fullAuto: "10" },
				},
			}),
		]);
		expect(rows[0].isRanged).toBe(true);
		expect(rows[0].rof).toEqual({
			singleShot: "S",
			burst: "3",
			fullAuto: "10",
		});
		expect(rows[0].clip).toBe(12);
	});

	test("is UNSORTED — callers own ordering (character sorts by name)", () => {
		const rows = weaponRows([
			weapon({ name: "Zeta" }),
			weapon({ name: "Alpha" }),
		]);
		expect(rows.map((r) => r.name)).toEqual(["Zeta", "Alpha"]);
	});
});

describe("armourLocations", () => {
	test("takes the highest worn AP per location, stowed armour excluded", () => {
		const rows = armourLocations([
			{
				type: "armour",
				system: {
					equipState: "worn",
					armourAt: (loc: string) => (loc === "head" ? 4 : 8),
				},
			},
			{
				type: "armour",
				system: { equipState: "stowed", armourAt: () => 99 },
			},
			{
				type: "armour",
				system: {
					equipState: "worn",
					armourAt: (loc: string) => (loc === "head" ? 2 : -1),
				},
			},
		]);
		const head = rows.find((r) => r.loc === "head");
		expect(head?.ap).toBe(4);
		expect(rows.every((r) => r.ap >= 0)).toBe(true);
	});

	test("returns a row for every body location, AP 0 with no armour", () => {
		expect(armourLocations([]).every((r) => r.ap === 0)).toBe(true);
		expect(armourLocations([]).length).toBeGreaterThan(0);
	});
});