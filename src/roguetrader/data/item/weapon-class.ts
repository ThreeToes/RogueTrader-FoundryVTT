/**
 * Weapon classes spanning all weapon types. Melee weapons choose `melee` (or
 * `thrown`); ranged weapons use the remaining classes.
 */
export enum WeaponClass {
	Melee = "melee",
	Thrown = "thrown",
	Pistol = "pistol",
	Basic = "basic",
	Heavy = "heavy",
}