/**
 * Shared actor-sheet view-model rows (bead v2ll): weapon combat rows and
 * per-location armour AP totals — previously built with near-identical code
 * in character-sheet.ts and npc-sheet.ts.
 *
 * Pure helpers, thin sheets (house style, see skills-domain.ts /
 * npc-inventory.ts): Foundry-free structural input types, callers adapt the
 * canonical rows into their own context shape (and do their own sorting —
 * weaponRows is deliberately UNSORTED so each sheet keeps its ordering).
 */

import { equipStateOf, isWeaponType } from "../../domain/model/taxonomy";
import { BODY_LOCATION_ORDER } from "../../registry";

/** Structural shape of an owned weapon item doc. */
export interface WeaponItemLike {
	id?: string | null;
	name?: string | null;
	type: string;
	system?: {
		class?: string;
		damage?: string;
		penetration?: number;
		clip?: number;
		rateOfFire?: {
			singleShot?: boolean | string | number;
			burst?: string;
			fullAuto?: string;
		} | null;
	} | null;
}

/** Structural shape of an owned armour item doc (equipState lives under system). */
export interface ArmourItemLike {
	type: string;
	system?: { equipState?: string | null; armourAt?: (loc: string) => number } | null;
}

/** One combat-tab weapon row (shared by PC + NPC sheets). */
export interface WeaponRow {
	id: string | null;
	name: string | null;
	classLabel: string;
	damage: string;
	penetration: number;
	isRanged: boolean;
	rof: { singleShot: string; burst: string; fullAuto: string };
	clip: number;
}

/**
 * Weapon rows for the combat tab, in item order — UNSORTED (bead v2ll): the
 * character sheet sorts by name, the NPC sheet keeps item order, so the
 * caller sorts. Weapon filtering reuses the shared isWeaponType predicate
 * from domain/model/taxonomy.
 */
export function weaponRows(items: WeaponItemLike[]): WeaponRow[] {
	return items
		.filter((item) => isWeaponType(item.type))
		.map((item) => {
			const sys = item.system ?? {};
			return {
				id: item.id ?? null,
				name: item.name ?? null,
				classLabel: `CLASS.${(sys.class ?? "melee").toUpperCase()}`,
				damage: sys.damage || "\u2013",
				penetration: sys.penetration ?? 0,
				isRanged: item.type === "ranged-weapon",
				rof: {
					singleShot: sys.rateOfFire?.singleShot ? "S" : "\u2013",
					burst: sys.rateOfFire?.burst || "\u2013",
					fullAuto: sys.rateOfFire?.fullAuto || "\u2013",
				},
				clip: sys.clip ?? 0,
			};
		});
}

/** One canonical per-location armour row. */
export interface ArmourLocationRow {
	loc: string;
	ap: number;
}

/**
 * Highest AP per body location across WORN armour (stowed armour contributes
 * nothing, matching the damage pipeline's wornArmour filter, bead yb6), in
 * BODY_LOCATION_ORDER. Callers adapt into their context shape (PC: record
 * keyed by loc; NPC: localized-label rows). Worn-ness reuses the shared
 * equipStateOf reader from domain/model/taxonomy.
 */
export function armourLocations(items: ArmourItemLike[]): ArmourLocationRow[] {
	const worn = items.filter(
		(item) => item.type === "armour" && equipStateOf(item) === "worn",
	);
	return BODY_LOCATION_ORDER.map((loc) => ({
		loc,
		ap: Math.max(
			0,
			...worn.map((item) => item.system?.armourAt?.(loc) ?? 0),
		),
	}));
}