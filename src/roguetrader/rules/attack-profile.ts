/**
 * Unified attack profiles (bead kam1). Two item shapes can be attacked with:
 *
 *   - WEAPON items (melee-weapon / ranged-weapon), whose profile is their own
 *     system data; and
 *   - MUTATION items carrying a printed `attack` block (Corrosive Bile, Core
 *     Rulebook p369), whose profile is authored on the mutation itself so no
 *     weapon-table field (Range, Penetration, Clip, Reload) has to be invented.
 *
 * The to-hit handler, the damage pipeline and the weapon-quality lookup all
 * consume this one shape, so a mutation attack travels the same road as a
 * weapon attack instead of growing a parallel pipeline.
 */

import { isWeaponType } from "../data/accessors";
import { normaliseDamageType } from "../data/item/damage-types";

/** The subset of a weapon Item the shared damage pipeline actually reads. */
export interface DamageSource {
	id?: string | null;
	name?: string;
	/** Drives melee-vs-ranged effect matching ("melee-weapon" | other). */
	type?: string;
	system?: {
		damage?: string;
		damageType?: string;
		penetration?: number;
		primitive?: boolean;
		special?: string[];
	};
}

/** A resolved attack: weapon or mutation, normalised. */
export interface AttackProfile {
	/** Item id the attack came from (per-item effect matching). */
	id: string | null;
	name: string;
	/** "melee-weapon" | "ranged-weapon" — drives melee-vs-ranged matching. */
	attackType: "melee-weapon" | "ranged-weapon";
	/** Test characteristic key ("ws" | "bs"). */
	characteristic: string;
	/** Damage formula, e.g. "1d10+2". */
	damage: string;
	/** Every printed damage type in book order (usually one). */
	damageTypes: string[];
	/** Weapon qualities / specials, lowercase ("tearing"). */
	qualities: string[];
	penetration: number;
	primitive: boolean;
	/**
	 * Defensive restrictions the book prints (bead kam1). Weapons are normally
	 * both parryable and dodgeable; Corrosive Bile is explicitly "can be
	 * dodged, but not parried". The pipeline does not enforce either (evasion
	 * stays manual), so these are surfaced on the damage card rather than
	 * being silently dropped.
	 */
	dodgeable: boolean;
	parryable: boolean;
	/** Printed action cost ("full"); blank when the book prints none. */
	action: string;
	/**
	 * True when the attack belongs to the body rather than to carried kit
	 * (mutations). Weapon items must be carried to attack; mutations are not
	 * equipped, so the carry gate must not apply to them.
	 */
	innate: boolean;
	/** DamageSource handed to the shared damage pipeline. */
	source: DamageSource;
}

/** Minimal structural view of an Item, for both shapes. */
interface ItemLike {
	id?: string | null;
	name?: string;
	type?: string;
	system?: unknown;
}

/** Printed attack block on a mutation (mirrors data/item/mutation.ts). */
interface MutationAttackLike {
	characteristic?: string;
	damage?: string;
	damageTypes?: string[];
	qualities?: string[];
	penetration?: number;
	action?: string;
	dodgeable?: boolean;
	parryable?: boolean;
}

/**
 * Resolve an Item's attack profile, or null when it has no attack.
 *
 * A weapon resolves from its own system data. A mutation resolves ONLY from an
 * authored `attack` block — a mutation without one is not an attack, however
 * combat-flavoured its prose. Anything else returns null.
 */
export function attackProfileOf(item: ItemLike | null | undefined): AttackProfile | null {
	if (!item) return null;
	const type = (item.type ?? "") as string;
	if (isWeaponType(type)) {
		const melee = type === "melee-weapon";
		const system = (item.system ?? {}) as DamageSource["system"];
		return {
			id: item.id ?? null,
			name: item.name ?? "",
			attackType: melee ? "melee-weapon" : "ranged-weapon",
			characteristic: melee ? "ws" : "bs",
			damage: system?.damage ?? "",
			damageTypes: system?.damageType ? [String(system.damageType)] : [],
			qualities: (system?.special ?? []).map(String),
			penetration: system?.penetration ?? 0,
			primitive: system?.primitive === true,
			// A weapon is a normal attack: parryable and dodgeable, with no
			// special printed action cost.
			dodgeable: true,
			parryable: true,
			action: "",
			innate: false,
			source: item as DamageSource,
		};
	}
	if (type !== "mutation") return null;
	const attack = (item.system as { attack?: MutationAttackLike } | undefined)
		?.attack;
	if (!attack?.damage) return null;
	const damageTypes = (attack.damageTypes ?? []).map(String).filter(Boolean);
	const qualities = (attack.qualities ?? []).map(String).filter(Boolean);
	// The damage pipeline takes one type at a time; the FIRST printed
	// alternative is the default (Corrosive Bile's "R (or E)" -> Rending), and
	// the rest stay on the profile so the card can show the choice.
	const penetration = attack.penetration ?? 0;
	return {
		id: item.id ?? null,
		name: item.name ?? "",
		// A Ballistic Skill attack is a ranged attack for effect matching even
		// though the mutation is not a ranged weapon.
		attackType: attack.characteristic === "ws" ? "melee-weapon" : "ranged-weapon",
		characteristic: attack.characteristic || "bs",
		damage: attack.damage,
		damageTypes,
		qualities,
		penetration,
		primitive: false,
		dodgeable: attack.dodgeable !== false,
		parryable: attack.parryable !== false,
		action: attack.action ?? "",
		innate: true,
		source: {
			id: item.id ?? null,
			name: item.name ?? "",
			type: attack.characteristic === "ws" ? "melee-weapon" : "ranged-weapon",
			system: {
				damage: attack.damage,
				damageType: damageTypes[0] ?? "",
				penetration,
				primitive: false,
				special: qualities,
			},
		},
	};
}

/** Canonical DamageType enum value for a profile's default damage type. */
export function profileDamageType(profile: AttackProfile): string | null {
	return normaliseDamageType(profile.damageTypes[0]) as string | null;
}
