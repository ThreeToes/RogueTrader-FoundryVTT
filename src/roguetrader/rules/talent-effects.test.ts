import { describe, expect, test } from "bun:test";
import {
	collectTalentDamageEffects,
	talentEffectHandlers,
} from "./talent-effects";

// Bead fjw: talent damage kinds. Data shapes follow the Table 4-1 benefit
// text (VERIFY prose p95-99):
//   Crushing Blow   (S 40)  "Deal +2 Damage with melee weapons."    -> kind "damage-flat", testKey "melee"
//   Crack Shot      (BS 40) "Deal +2 Critical Damage with ranged weapon." -> kind "critical-damage", testKey "ranged"
//   Crippling Strike (WS 50) "Deal +4 Critical Damage with melee weapon." -> kind "critical-damage", testKey "melee"

const crushingBlow = {
	type: "talent",
	system: { effects: [{ kind: "damage-flat", testKey: "melee", value: 2, label: "Crushing Blow" }] },
};
const crackShot = {
	type: "talent",
	system: {
		effects: [
			{ kind: "critical-damage", testKey: "ranged", value: 2, label: "Crack Shot" },
		],
	},
};
const guardedTalent = {
	type: "talent",
	system: {
		effects: [
			{
				kind: "damage-flat",
				testKey: "melee",
				value: 2,
				label: "Frenzied Blow",
				condition: "frenzied",
			},
		],
	},
};

describe("collectTalentDamageEffects", () => {
	test("melee-keyed damage-flat applies to melee attacks", () => {
		const { damage, critical } = collectTalentDamageEffects(
			{ items: [crushingBlow, crackShot] },
			{ attackType: "melee-weapon" },
		);
		expect(damage).toHaveLength(1);
		expect(damage[0].label).toBe("Crushing Blow");
		expect(damage[0].value).toBe(2);
		expect(critical).toHaveLength(0);
	});

	test("ranged-keyed critical-damage applies to ranged attacks", () => {
		const { damage, critical } = collectTalentDamageEffects(
			{ items: [crushingBlow, crackShot] },
			{ attackType: "ranged-weapon" },
		);
		expect(damage).toHaveLength(0);
		expect(critical).toHaveLength(1);
		expect(critical[0].label).toBe("Crack Shot");
		expect(critical[0].value).toBe(2);
	});

	test("wildcard testKey applies to both attack types", () => {
		const wildcard = {
			type: "talent",
			system: {
				effects: [{ kind: "damage-flat", testKey: "", value: 1, label: "Any Weapon" }],
			},
		};
		for (const attackType of ["melee-weapon", "ranged-weapon"] as const) {
			const { damage } = collectTalentDamageEffects(
				{ items: [wildcard] },
				{ attackType },
			);
			expect(damage).toHaveLength(1);
		}
	});

	test("contributions stack across talents", () => {
		const { critical } = collectTalentDamageEffects(
			{
				items: [crackShot, { ...crackShot, system: { effects: [{ kind: "critical-damage", testKey: "ranged", value: 4, label: "Crippling Shot" }] } }],
			},
			{ attackType: "ranged-weapon" },
		);
		expect(critical.map((m) => m.value)).toEqual([2, 4]);
	});

	test("condition guard skips effects without the flag", () => {
		const without = collectTalentDamageEffects(
			{ items: [guardedTalent] },
			{ attackType: "melee-weapon" },
		);
		expect(without.damage).toHaveLength(0);

		const withFlag = collectTalentDamageEffects(
			{ items: [guardedTalent] },
			{ attackType: "melee-weapon", flags: { frenzied: true } },
		);
		expect(withFlag.damage).toHaveLength(1);
		expect(withFlag.damage[0].condition).toBe("frenzied");
	});

	test("non-talent items and non-damage kinds are ignored", () => {
		const actor = {
			items: [
				{ type: "weapon", system: { effects: [{ kind: "damage-flat", value: 99 }] } },
				{
					type: "talent",
					system: { effects: [{ kind: "wounds-max", value: 1 }, { kind: "test-modifier", testKey: "ws", value: 10 }] },
				},
			],
		};
		const { damage, critical } = collectTalentDamageEffects(actor, {
			attackType: "melee-weapon",
		});
		expect(damage).toHaveLength(0);
		expect(critical).toHaveLength(0);
	});

	test("zero/invalid values are ignored", () => {
		const actor = {
			items: [
				{
					type: "talent",
					system: {
						effects: [
							{ kind: "damage-flat", testKey: "melee", value: 0 },
							{ kind: "damage-flat", testKey: "melee", value: Number.NaN },
						],
					},
				},
			],
		};
		const { damage } = collectTalentDamageEffects(actor, {
			attackType: "melee-weapon",
		});
		expect(damage).toHaveLength(0);
	});
});

describe("talent effect registry kinds (bead fjw)", () => {
	test("damage-flat and critical-damage kinds are registered", () => {
		const kinds = talentEffectHandlers.kinds();
		expect(kinds).toContain("damage-flat");
		expect(kinds).toContain("critical-damage");
	});

	test("handlers return the effect value", () => {
		const talent = { name: "Crushing Blow", system: { effects: [] } };
		const [flat] = talentEffectHandlers.run(
			{},
			talent,
			{ kind: "damage-flat", value: 2 },
		);
		expect(flat).toBe(2);
		const [crit] = talentEffectHandlers.run(
			{},
			talent,
			{ kind: "critical-damage", value: 4 },
		);
		expect(crit).toBe(4);
	});
});
// Bead 2k5: the attacking weapon's own damage effects apply; gear/armour
// damage effects stay inert (no book basis for worn armour adding damage).
describe("weapon-scoped damage effects (bead 2k5)", () => {
	const weapon = (equipState?: string) => ({
		id: "weapon-1",
		name: "Chainsword",
		type: "melee-weapon",
		equipState,
		system: {
			effects: [{ kind: "damage-flat", value: 3, label: "Serrated" }],
		},
	});
	const otherWeapon = {
		id: "weapon-2",
		name: "Lasgun",
		type: "ranged-weapon",
		equipState: "carried",
		system: { effects: [{ kind: "damage-flat", value: 99, label: "Not This One" }] },
	};
	const inertArmour = {
		id: "armour-1",
		name: "Flak",
		type: "armour",
		equipState: "worn",
		system: { effects: [{ kind: "damage-flat", value: 50, label: "No Basis" }] },
	};

	test("the attacking weapon's own damage effects apply", () => {
		const { damage } = collectTalentDamageEffects(
			{ items: [weapon("carried"), otherWeapon, inertArmour] },
			{ attackType: "melee-weapon", weaponId: "weapon-1" },
		);
		expect(damage).toHaveLength(1);
		expect(damage[0].label).toBe("Serrated");
		expect(damage[0].id).toContain("Chainsword");
	});

	test("other weapons' effects do not leak into the attack", () => {
		const { damage } = collectTalentDamageEffects(
			{ items: [weapon("carried"), otherWeapon] },
			{ attackType: "melee-weapon", weaponId: "weapon-1" },
		);
		expect(damage.find((m) => m.label === "Not This One")).toBeUndefined();
	});

	test("stowed attacking weapon is not live (equip-state model)", () => {
		const { damage } = collectTalentDamageEffects(
			{ items: [weapon("stowed")] },
			{ attackType: "melee-weapon", weaponId: "weapon-1" },
		);
		expect(damage).toHaveLength(0);
	});

	test("armour/gear damage effects stay inert (documented decision)", () => {
		const { damage } = collectTalentDamageEffects(
			{ items: [inertArmour] },
			{ attackType: "melee-weapon", weaponId: "weapon-1" },
		);
		expect(damage).toHaveLength(0);
	});

	test("talent ids remain stable (no weapon prefix)", () => {
		const { damage } = collectTalentDamageEffects(
			{ items: [crushingBlow] },
			{ attackType: "melee-weapon", weaponId: "weapon-1" },
		);
		expect(damage[0].id.startsWith("talent-damage:")).toBe(true);
	});
});
