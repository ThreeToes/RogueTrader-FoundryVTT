import { describe, expect, test } from "bun:test";
import { acceptsOrdnance, attackProfileOf, ordnanceFamilyOf } from "./attack";

// Bead kam1: weapons and printed mutation attacks resolve to ONE profile shape
// so the to-hit handler and damage pipeline do not fork.
// Moved from rules/attack-profile.test.ts in phase 1.

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
		expect(
			attackProfileOf({ name: "Backpack", type: "gear", system: {} }),
		).toBeNull();
		expect(
			attackProfileOf({ name: "Flak", type: "armour", system: {} }),
		).toBeNull();
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

// ---------------------------------------------------------------------------
// Standalone-fire launchers (bead pht2): a launcher WITHOUT acceptsAmmo
// carries its own COMPLETE printed profile (Core Rulebook p114: default
// ammunition is an abstract included supply, only unusual ammo is itemised;
// Into the Storm p113 forbids unusual ammo on these launchers) — it resolves
// as a normal ranged weapon and NOTHING load side is consulted.
// ---------------------------------------------------------------------------

const rokkitLauncha = {
	id: "w4",
	name: "Rokkit Launcha",
	type: "ranged-weapon",
	system: {
		damage: "3d10+5",
		damageType: "Explosive",
		penetration: 4,
		weaponFamily: "launcher",
		class: "basic",
		special: ["unreliable"],
		// Even a stale load id must not resurrect the load machinery.
		loadedAmmoId: "a1",
		// acceptsAmmo ABSENT — the book models no swappable ordnance here.
	},
};

describe("attackProfileOf standalone-launcher branch (bead pht2)", () => {
	test("a launcher without acceptsAmmo fires its OWN printed profile", () => {
		const profile = attackProfileOf(rokkitLauncha, () => fragMissile);
		expect(profile?.damage).toBe("3d10+5");
		expect(profile?.damageTypes).toEqual(["Explosive"]);
		expect(profile?.penetration).toBe(4);
		expect(profile?.qualities).toEqual(["unreliable"]);
		expect(profile?.characteristic).toBe("bs");
		expect(profile?.attackType).toBe("ranged-weapon");
		// No load machinery: no fired stamp, no unusable refusal.
		expect(profile?.fired ?? null).toBe(null);
		expect(profile?.unusable ?? false).toBe(false);
	});

	test("a launcher with WHITESPACE acceptsAmmo is standalone (trim-gate)", () => {
		const profile = attackProfileOf({
			...rokkitLauncha,
			system: { ...rokkitLauncha.system, acceptsAmmo: "   " },
		});
		expect(profile?.damage).toBe("3d10+5");
		expect(profile?.unusable ?? false).toBe(false);
	});

	test("a launcher WITH acceptsAmmo never takes the standalone path", () => {
		// Even though the weapon row carries a damage value (a data-entry
		// mistake), the load branch replaces it: an EMPTY load refuses (the
		// book prints "—"/"Varies with ammunition" for this launcher).
		const profile = attackProfileOf({
			...missileLauncher,
			system: {
				...missileLauncher.system,
				damage: "9d9",
				loadedAmmoId: "",
			},
		});
		expect(profile?.unusable).toBe(true);
		expect(profile?.damage).toBe("");
	});
});

describe("damageless ordnance loads but refuses fire (bead pht2)", () => {
	// Web Missile (Hostile Acquisitions Table 2-11, printed p52) and the
	// Starflare Round (Into the Storm Table 3-2, printed p117): the book
	// prints Dam "—" — the KIND is the load compatibility, but there is no
	// damage formula to roll. A proper no-damage attack path is an owner
	// follow-up; the model keeps the established warn-and-refuse semantics.
	const webMissile = {
		id: "a4",
		name: "Web Missile",
		type: "ammunition",
		uuid: "Actor.x.Item.a4",
		system: {
			quantity: 2,
			ordnance: { kind: "missile", qualities: ["blast-6", "snare"] },
		},
	};

	test("a damageless missile-kind round IS accepted ordnance", () => {
		expect(ordnanceFamilyOf(webMissile)).toBe("missile");
		expect(acceptsOrdnance(missileLauncher, webMissile)).toBe(true);
	});

	test("a loaded damageless round is unusable (no damage formula to roll)", () => {
		const profile = attackProfileOf({
			...missileLauncher,
			system: { ...missileLauncher.system, loadedAmmoId: "a4" },
		},	(id) => (id === "a4" ? webMissile : null));
		expect(profile?.unusable).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Launcher load model (bead 4obp, epic nlsh): attackProfileOf's ammoResolver
// branch — loaded ordnance supplies the fire profile (dispatch on the loaded
// item's TYPE); an unloaded launcher is unusable (warn-and-refuse later).
// ---------------------------------------------------------------------------

const missileLauncher = {
	id: "w3",
	name: "Missile Launcher (Locke)",
	type: "ranged-weapon",
	system: {
		damage: "—",
		damageType: "Impact",
		penetration: 0,
		weaponFamily: "launcher",
		class: "heavy",
		loadedAmmoId: "a1",
		acceptsAmmo: "missile",
	},
};

const fragMissile = {
	id: "a1",
	name: "Frag Missile",
	type: "ammunition",
	uuid: "Actor.x.Item.a1",
	system: {
		quantity: 6,
		ordnance: {
			kind: "missile",
			damage: "2d10",
			damageType: "Explosive",
			penetration: 4,
			qualities: ["blast-6"],
		},
	},
};

const fragGrenade = {
	id: "g1",
	name: "Frag",
	type: "ranged-weapon",
	uuid: "Actor.x.Item.g1",
	system: {
		class: "thrown",
		weaponFamily: "thrown",
		damage: "2d10+3",
		damageType: "Explosive",
		penetration: 0,
		special: ["blast-3"],
		quantity: 3,
	},
};

describe("attackProfileOf launcher load branch (bead 4obp)", () => {
	test("a loaded launcher derives its fire profile from missile ammunition", () => {
		const profile = attackProfileOf(missileLauncher, (id) =>
			id === "a1" ? fragMissile : null,
		);
		expect(profile).not.toBeNull();
		expect(profile?.damage).toBe("2d10");
		expect(profile?.damageTypes).toEqual(["Explosive"]);
		expect(profile?.penetration).toBe(4);
		expect(profile?.qualities).toEqual(["blast-6"]);
		// Range/RoF/clip/class stay on the launcher via its own system; the
		// profile's source IS the launcher.
		expect(profile?.source).toBe(missileLauncher);
		// Funnel stamp (D4): the fired item rides the profile.
		expect(profile?.unusable).toBe(false);
		expect(profile?.fired).toEqual({
			uuid: "Actor.x.Item.a1",
			name: "Frag Missile",
			quantity: 6,
		});
	});

	test("a loaded grenade launcher derives from the grenade weapon's OWN fields", () => {
		const gla = {
			...missileLauncher,
			system: { ...missileLauncher.system, loadedAmmoId: "g1", acceptsAmmo: "grenade" },
		};
		const profile = attackProfileOf(gla, (id) => (id === "g1" ? fragGrenade : null));
		expect(profile?.damage).toBe("2d10+3");
		expect(profile?.qualities).toEqual(["blast-3"]);
		// The grenade STAYS unchanged: no mutation of the loaded item happened.
		expect(fragGrenade.system.damage).toBe("2d10+3");
		expect(profile?.fired?.uuid).toBe("Actor.x.Item.g1");
		expect(profile?.fired?.quantity).toBe(3);
	});

	test("an UNLOADED launcher resolves an unusable profile (warn-and-refuse)", () => {
		const profile = attackProfileOf({
			...missileLauncher,
			system: { ...missileLauncher.system, loadedAmmoId: "" },
		});
		expect(profile?.unusable).toBe(true);
		expect(profile?.fired ?? null).toBe(null);
		// The to-hit fields survive (the attack still resolves a BS test).
		expect(profile?.characteristic).toBe("bs");
		expect(profile?.attackType).toBe("ranged-weapon");
	});

	test("a launcher whose loaded item no longer exists is unusable", () => {
		const profile = attackProfileOf(missileLauncher, (id) =>
			id === "a1" ? null : null, // deleted ammo
		);
		expect(profile?.unusable).toBe(true);
	});

	test("a launcher loaded with PLAIN ammunition (no ordnance block) is unusable", () => {
		const profile = attackProfileOf(missileLauncher, (id) =>
			id === "a1"
				? { id: "a2", name: "Bullets", type: "ammunition", system: {} }
				: null,
		);
		expect(profile?.unusable).toBe(true);
	});

	test("melee weapons and mutations are untouched by the resolver", () => {
		expect(attackProfileOf(melee, () => fragMissile)?.damage).toBe("1d10+3");
		// A mutation is never a launcher: its authored block still wins.
		expect(attackProfileOf(corrosiveBile, () => fragMissile)?.damage).toBe(
			"1d10+2",
		);
	});
});

describe("launcher-ordnance compatibility (bead 4obp)", () => {
	test("a missile launcher accepts ammunition whose ordnance kind is missile", () => {
		expect(acceptsOrdnance(missileLauncher, fragMissile)).toBe(true);
	});
	test("a missile launcher rejects grenade weapons and plain ammunition", () => {
		const plain = { id: "a3", name: "Bullets", type: "ammunition", system: {} };
		expect(acceptsOrdnance(missileLauncher, fragGrenade)).toBe(false);
		expect(acceptsOrdnance(missileLauncher, plain)).toBe(false);
	});
	test("a grenade launcher accepts throw-family ranged weapons, not other weapons", () => {
		const gla = {
			...missileLauncher,
			system: { ...missileLauncher.system, acceptsAmmo: "grenade" },
		};
		expect(acceptsOrdnance(gla, fragGrenade)).toBe(true);
		const lasgun = {
			...fragGrenade,
			name: "Lasgun",
			system: { ...fragGrenade.system, class: "basic", weaponFamily: "las" },
		};
		expect(acceptsOrdnance(gla, lasgun)).toBe(false);
	});
	test("an empty acceptsAmmo accepts nothing", () => {
		const unconfigured = {
			...missileLauncher,
			system: { ...missileLauncher.system, acceptsAmmo: "" },
		};
		expect(acceptsOrdnance(unconfigured, fragMissile)).toBe(false);
	});
});
