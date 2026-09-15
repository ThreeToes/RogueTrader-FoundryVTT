import { describe, expect, test } from "bun:test";
import { attackProfileOf } from "./attack-profile";

// Bead kam1: weapons and printed mutation attacks resolve to ONE profile shape
// so the to-hit handler and damage pipeline do not fork.

const melee = {
	id: "w1",
	name: "Chainsword",
	type: "melee-weapon",
	system: {
		damage: "1d10+3",
		damageType: "Rending",
		penetration: 2,
		special: ["tearing"],
	},
};

const ranged = {
	id: "w2",
	name: "Lasgun",
	type: "ranged-weapon",
	system: { damage: "1d10+3", damageType: "Energy", penetration: 0 },
};

// Corrosive Bile, Core Rulebook p369, verbatim:
// "The mutant must test Ballistic Skill to use this mutation. Using it is a
//  full action. It can be dodged, but not parried. On a successful test, the
//  attack deals 1d10+2 R (or E) Tearing Damage."
const corrosiveBile = {
	id: "m1",
	name: "Corrosive Bile",
	type: "mutation",
	system: {
		attack: {
			characteristic: "bs",
			damage: "1d10+2",
			damageTypes: ["R", "E"],
			qualities: ["tearing"],
			action: "full",
			dodgeable: true,
			parryable: false,
		},
	},
};

describe("attackProfileOf (bead kam1)", () => {
	test("a melee weapon tests Weapon Skill and is not innate", () => {
		const profile = attackProfileOf(melee);
		expect(profile?.characteristic).toBe("ws");
		expect(profile?.attackType).toBe("melee-weapon");
		expect(profile?.innate).toBe(false);
		expect(profile?.damage).toBe("1d10+3");
		expect(profile?.penetration).toBe(2);
		expect(profile?.qualities).toEqual(["tearing"]);
	});

	test("a ranged weapon tests Ballistic Skill", () => {
		const profile = attackProfileOf(ranged);
		expect(profile?.characteristic).toBe("bs");
		expect(profile?.attackType).toBe("ranged-weapon");
		expect(profile?.source.system?.damageType).toBe("Energy");
	});

	test("a mutation with an attack block resolves like a weapon", () => {
		const profile = attackProfileOf(corrosiveBile);
		expect(profile?.characteristic).toBe("bs");
		expect(profile?.attackType).toBe("ranged-weapon");
		expect(profile?.damage).toBe("1d10+2");
		// Both printed alternatives survive; the first is the default the
		// damage pipeline resolves, the rest go on the card.
		expect(profile?.damageTypes).toEqual(["R", "E"]);
		expect(profile?.qualities).toEqual(["tearing"]);
		expect(profile?.penetration).toBe(0);
		expect(profile?.source.system?.damageType).toBe("R");
	});

	test("a mutation attack is INNATE (never gated on equip state)", () => {
		// Mutations are not carried kit, so the weaponHandler's carry gate must
		// not apply to them.
		expect(attackProfileOf(corrosiveBile)?.innate).toBe(true);
		expect(attackProfileOf(melee)?.innate).toBe(false);
	});

	test("a mutation whose attack block is blank has no attack", () => {
		// `damage` is the discriminator: prose that merely mentions violence
		// must not become an attack button.
		expect(
			attackProfileOf({
				name: "Grotesque",
				type: "mutation",
				system: {
					attack: {
						characteristic: "",
						damage: "",
						damageTypes: [],
						qualities: [],
					},
				},
			}),
		).toBeNull();
	});

	test("a mutation with no attack block at all has no attack", () => {
		expect(
			attackProfileOf({ name: "Tough Hide", type: "mutation", system: {} }),
		).toBeNull();
	});

	test("non-attack item types have no profile", () => {
		expect(attackProfileOf({ name: "Backpack", type: "gear", system: {} })).toBeNull();
		expect(attackProfileOf({ name: "Flak", type: "armour", system: {} })).toBeNull();
	});

	test("nullish input is safe", () => {
		expect(attackProfileOf(null)).toBeNull();
		expect(attackProfileOf(undefined)).toBeNull();
	});

	test("a Weapon Skill mutation is a melee attack", () => {
		const profile = attackProfileOf({
			name: "Clawed/Fanged",
			type: "mutation",
			system: {
				attack: { characteristic: "ws", damage: "1d5+SB", damageTypes: ["R"] },
			},
		});
		expect(profile?.characteristic).toBe("ws");
		expect(profile?.attackType).toBe("melee-weapon");
		expect(profile?.damageTypes).toEqual(["R"]);
		expect(profile?.qualities).toEqual([]);
	});
});
