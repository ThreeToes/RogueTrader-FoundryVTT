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

// ---------------------------------------------------------------------------
// Bead gci0: roll-mechanic kinds (Tearing/Toxic/Blast). Book wording (Core
// Rulebook Armoury quality prose): Tearing = "roll one extra die for damage,
// and the lowest result is discarded"; Toxic = Toughness test at -5 per
// damage taken, failure = 1d10 Impact no armour/TB; Blast (X) = everyone
// within X metres also hit.
// ---------------------------------------------------------------------------
import { applyTearing, collectRollMechanicEffects, parseSpecialMechanics } from "./talent-effects";

describe("parseSpecialMechanics", () => {
	test("parses tearing/toxic/blast-N special strings", () => {
		const m = parseSpecialMechanics(["tearing", "toxic", "blast-4"]);
		expect(m).toEqual({ tearing: true, toxic: true, blast: 4 });
	});

	test("accepts blast (X) paren form and bare blast (rating 0)", () => {
		expect(parseSpecialMechanics(["blast (3)"]).blast).toBe(3);
		expect(parseSpecialMechanics(["Blast"]).blast).toBe(0);
	});

	test("unrelated qualities are ignored", () => {
		const m = parseSpecialMechanics(["accurate", "reliable", "storm"]);
		expect(m).toEqual({ tearing: false, toxic: false, blast: null });
	});

	test("undefined/empty special lists yield inert mechanics", () => {
		expect(parseSpecialMechanics(undefined)).toEqual({
			tearing: false,
			toxic: false,
			blast: null,
		});
	});
});

describe("collectRollMechanicEffects", () => {
	const weapon = (special: string[], effects: object[] = []) => ({
		id: "w1",
		type: "ranged-weapon",
		system: { special, effects },
	});

	test("weapon special strings seed the mechanics", () => {
		const m = collectRollMechanicEffects(
			{ items: [weapon(["tearing", "blast-1"])] },
			{ weaponId: "w1", attackType: "ranged-weapon" },
		);
		expect(m.tearing).toBe(true);
		expect(m.blast).toBe(1);
	});

	test("talent effects with the kinds contribute (blast keeps max)", () => {
		const talent = {
			type: "talent",
			system: {
				effects: [
					{ kind: "blast", value: 3 },
					{ kind: "tearing" },
				],
			},
		};
		const m = collectRollMechanicEffects(
			{ items: [weapon(["blast-1"]), talent] },
			{ weaponId: "w1", attackType: "ranged-weapon" },
		);
		expect(m.tearing).toBe(true);
		expect(m.blast).toBe(3);
	});

	test("other actors' weapons are ignored; only the attacking weapon", () => {
		const other = { id: "w2", type: "ranged-weapon", system: { special: ["tearing"] } };
		const m = collectRollMechanicEffects(
			{ items: [other, weapon([])] },
			{ weaponId: "w1", attackType: "ranged-weapon" },
		);
		expect(m.tearing).toBe(false);
	});
});

describe("applyTearing", () => {
	test("extra die beats lowest base die: added = extra - lowest", () => {
		expect(applyTearing([5], 7, 10)).toEqual({ added: 2, discarded: 5 });
	});

	test("extra die ties lowest: added 0", () => {
		expect(applyTearing([3, 6], 3, 10)).toEqual({ added: 0, discarded: 3 });
	});

	test("multi-die roll: lowest across base dice + extra is discarded", () => {
		expect(applyTearing([2, 8], 9, 10)).toEqual({ added: 7, discarded: 2 });
		expect(applyTearing([9, 8], 1, 10)).toEqual({ added: 0, discarded: 1 });
	});
});

describe("roll-mechanic kinds are discoverable (bead gci0)", () => {
	test("kinds() includes tearing, toxic and blast", () => {
		const kinds = talentEffectHandlers.kinds();
		for (const kind of ["tearing", "toxic", "blast"]) {
			expect(kinds.includes(kind)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Target-side trait damage machinery (bead zyv1).
// ---------------------------------------------------------------------------
import {
	collectTargetTraitDamageEffects,
} from "./talent-effects";

describe("collectTargetTraitDamageEffects (bead zyv1)", () => {
	const trait = (name: string, effects: unknown[]) => ({
		name,
		type: "trait",
		system: { effects },
	});

	test("tb-multiplier traits expose the multiplier; strongest wins", () => {
		const t = collectTargetTraitDamageEffects({
			items: [
				trait("Unnatural Toughness (×2)", [
					{ kind: "tb-multiplier", value: 2 },
				]),
				trait("Stranger trait", [{ kind: "tb-multiplier", value: 3 }]),
			],
		});
		expect(t.tbMultiplier).toBe(3);
	});

	test("damage-reduction rows become additive Modifier contributors", () => {
		const t = collectTargetTraitDamageEffects({
			items: [
				trait("Machine (6)", [
					{ kind: "damage-reduction", value: 6 },
				]),
				trait("Plated", [{ kind: "damage-reduction", value: 2, label: "Plating" }]),
			],
		});
		expect(t.reduction).toHaveLength(2);
		expect(t.reduction.reduce((s, m) => s + m.value, 0)).toBe(8);
		expect(t.reduction[0].label).toBe("Machine (6)");
		expect(t.reduction[0].source).toEqual({ type: "item", label: "SOURCE.FROM_TRAITS" });
		expect(t.reduction[1].id).toContain("Plated");
	});

	test("non-trait items and non-damage kinds are ignored", () => {
		const t = collectTargetTraitDamageEffects({
			items: [
				{
					name: "Crushing Blow",
					type: "talent",
					system: {
						effects: [{ kind: "damage-reduction", value: 5 }],
					},
				},
				trait("Fear (2)", [{ kind: "test-modifier", value: -10 }]),
			],
		});
		expect(t.tbMultiplier).toBeNull();
		expect(t.reduction).toHaveLength(0);
	});

	test("invalid values are skipped, not zeroed (loud data)", () => {
		const t = collectTargetTraitDamageEffects({
			items: [
				trait("Bad multiplier", [{ kind: "tb-multiplier", value: 0 }]),
				trait("Bad reduction", [{ kind: "damage-reduction", value: -3 }]),
				trait("NaN", [{ kind: "damage-reduction", value: Number.NaN }]),
			],
		});
		expect(t.tbMultiplier).toBeNull();
		expect(t.reduction).toHaveLength(0);
	});

	test("no items at all is a clean empty collection", () => {
		expect(collectTargetTraitDamageEffects({})).toEqual({
			tbMultiplier: null,
			reduction: [],
		});
	});
});
