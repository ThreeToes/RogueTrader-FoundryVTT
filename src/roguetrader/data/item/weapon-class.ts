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

export const MELEE_CLASSES: WeaponClass[] = [WeaponClass.Melee, WeaponClass.Thrown];
export const RANGED_CLASSES: WeaponClass[] = [
	WeaponClass.Basic,
	WeaponClass.Pistol,
	WeaponClass.Heavy,
	WeaponClass.Thrown,
];