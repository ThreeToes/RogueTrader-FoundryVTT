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
 *
 * Moved from `rules/attack-profile.ts` (phase 1): it is pure domain logic, so
 * it lives in the domain model and the Foundry builder resolves `attack` once
 * per item.
 */

import { normaliseDamageType } from "./damage";
import { isWeaponType } from "./taxonomy";

/** The subset of a weapon's system data the damage pipeline reads. */
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

/** Minimal structural view of an item that may carry an attack. */
export interface AttackSource {
	id?: string | null;
	name?: string;
	type?: string;
	system?: unknown;
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
	/**
	 * The fired ordnance item the profile was derived from (bead 4obp).
	 * Stamped ONLY when a launcher's loaded item supplied the profile (missile
	 * ammunition or a throw-family grenade weapon); null otherwise. The damage
	 * card's usage chip shows the name + remaining quantity, and the chip's
	 * decrement button spends one through the fired item's uuid.
	 */
	fired?: FiredOrdnance | null;
	/**
	 * A launcher with nothing usable loaded (bead 4obp): the damage path
	 * warns and REFUSES — the book prints "—" for launcher damage (Table 5-6
	 * / 5-5 "Varies with ammunition"), so an unloaded launcher has no damage
	 * formula to roll. No prompt fallback (owner decision, epic nlsh).
	 */
	unusable?: boolean;
}

/** The ordnance item a launcher fired: what the usage chip + spending need. */
export interface FiredOrdnance {
	/** The fired item's document uuid (the decrement button's target). */
	uuid: string | null;
	name: string;
	/** Remaining quantity on the fired item (Gear base, bead 1sxq). */
	quantity: number;
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
 * Structural view of a loaded-ordnance candidate: the launcher's resolver
 * hands these back (actor-owned ammunition or grenade weapon documents).
 * Deliberately structural — the domain layer must stay Foundry-free.
 */
export interface LoadableOrdnance {
	type?: string;
	name?: string;
	uuid?: string;
	system?: {
		ordnance?: {
			kind?: string;
			damage?: string;
			damageType?: string;
			penetration?: number;
			qualities?: string[];
		};
		// Grenade weapons: the thrown-family class/weaponFamily the "grenade"
		// acceptance kind reads (their own weapon fields are the fire profile).
		class?: string;
		weaponFamily?: string;
		damage?: string;
		damageType?: string;
		penetration?: number;
		special?: string[];
		quantity?: number;
	};
}

/**
 * Actor-side lookup the profile resolver calls to find a launcher's loaded
 * item: `(id) => actor.items.get(id)`. Foundry-facing; attack.ts stays pure.
 */
export type AmmoResolver = (id: string) => LoadableOrdnance | null | undefined;

/**
 * The weaponFamily key the load model gates on (epic nlsh): launchers fire
 * LOADED ordnance — missiles (ammunition items) or grenades (thrown-family
 * ranged-weapon items) — and have no damage of their own.
 */
export const LAUNCHER_FAMILY = "launcher";

/**
 * What a candidate item supplies as ordnance (bead 4obp), by KIND:
 *   - ammunition items carry the structured `ordnance` block — the kind is
 *     the block's own `kind` ("missile" in the pack);
 *   - grenade weapons STAY ranged-weapon items (hand-throwable) — the kind is
 *     "grenade", carried by the item being in the book's thrown family
 *     (class or weaponFamily "thrown"); the launcher reads their EXISTING
 *     weapon fields.
 * Anything else — plain ammunition, pistols, raw gear — is not ordnance: null.
 */
export function ordnanceFamilyOf(item: LoadableOrdnance): string | null {
	if (item.type === "ammunition") {
		const block = item.system?.ordnance;
		if (!block?.damage || !block.kind) return null;
		return String(block.kind);
	}
	if (item.type === "ranged-weapon") {
		const sys = item.system ?? {};
		const klass = String(sys.class ?? "").toLowerCase();
		const family = String(sys.weaponFamily ?? "").toLowerCase();
		// The book's grenade rows sit in the thrown family (Table 5-6):
		// launcher-firable grenades keep class/weaponFamily thrown.
		return klass === "thrown" || family === "thrown" ? "grenade" : null;
	}
	return null;
}

/**
 * May `candidate` be loaded into `launcher`? The launcher names its accepted
 * kind in `acceptsAmmo` ("missile" / "grenade"); an empty acceptance means it
 * accepts nothing (explicit, homebrew-friendly — epic nlsh launcher-
 * compatibility card).
 */
export function acceptsOrdnance(
	launcher: { system?: { acceptsAmmo?: string } },
	candidate: LoadableOrdnance,
): boolean {
	const accepts = String(launcher.system?.acceptsAmmo ?? "")
		.trim()
		.toLowerCase();
	if (!accepts) return false;
	return ordnanceFamilyOf(candidate) === accepts;
}

/**
 * The profile fields a loaded ordnance item supplies (bead 4obp): the branch
 * DISPATCHES on the loaded item's TYPE — ammunition resolves its `ordnance`
 * block; a grenade weapon resolves its own unchanged weapon fields.
 * Returns null when the item supplies nothing usable (missing document,
 * plain ammunition, a damage-less grenade) — that is the warn-and-refuse
 * case, never a silent fallback to the launcher's own "—" damage.
 */
export function ordnanceFieldsOf(
	loaded: LoadableOrdnance | null | undefined,
): {
	damage: string;
	damageTypes: string[];
	penetration: number;
	qualities: string[];
} | null {
	if (!loaded) return null;
	if (loaded.type === "ammunition") {
		const block = loaded.system?.ordnance;
		if (!block?.damage) return null;
		const qualities = (block.qualities ?? []).map(String).filter(Boolean);
		return {
			damage: block.damage,
			damageTypes: block.damageType ? [String(block.damageType)] : [],
			penetration: block.penetration ?? 0,
			qualities,
		};
	}
	if (loaded.type === "ranged-weapon") {
		const sys = loaded.system ?? {};
		if (!sys.damage) return null;
		const qualities = (sys.special ?? []).map(String).filter(Boolean);
		return {
			damage: sys.damage,
			damageTypes: sys.damageType ? [String(sys.damageType)] : [],
			penetration: sys.penetration ?? 0,
			qualities,
		};
	}
	return null;
}

/**
 * The launcher's load branch (bead 4obp / design D4): the profile reads
 * damage/type/penetration/qualities FROM the loaded ordnance (dispatch on its
 * type, ordnanceFieldsOf) while range, RoF, clip, reload, class and the
 * training gate stay on the launcher (they resolve from the profile's item and
 * the launcher's own system, respectively). Empty load / missing document /
 * unusable load = the launcher stays unusable — the damage path refuses.
 */
export function launcherProfile(
	base: AttackProfile,
	loadedAmmoId: string,
	ammoResolver?: AmmoResolver,
): AttackProfile {
	const loadedId = String(loadedAmmoId ?? "").trim();
	const loaded = loadedId && ammoResolver ? ammoResolver(loadedId) : null;
	const fields = ordnanceFieldsOf(loaded);
	if (!loaded || !fields) {
		return { ...base, damage: "", fired: null, unusable: true };
	}
	// The funnel stamp (design D4 seam extension): the card must know WHAT
	// fired, so its usage chip can name the item and spend one on click.
	return {
		...base,
		damage: fields.damage,
		damageTypes: fields.damageTypes,
		qualities: fields.qualities,
		penetration: fields.penetration,
		fired: {
			uuid: loaded.uuid ?? null,
			name: loaded.name ?? "",
			quantity: Number(loaded.system?.quantity ?? 0),
		},
		unusable: false,
	};
}

/**
 * Resolve an Item's attack profile, or null when it has no attack.
 *
 * A weapon resolves from its own system data — except a LAUNCHER, whose fire
 * profile derives from its loaded ordnance through the optional actor-side
 * `ammoResolver` (bead 4obp): unloaded, a launcher yields an unusable profile
 * the damage path refuses. A mutation resolves ONLY from an authored `attack`
 * block — a mutation without one is not an attack, however combat-flavoured
 * its prose. Anything else returns null.
 */
export function attackProfileOf(
	item: AttackSource | null | undefined,
	ammoResolver?: AmmoResolver,
): AttackProfile | null {
	if (!item) return null;
	const type = (item.type ?? "") as string;
	if (isWeaponType(type)) {
		const melee = type === "melee-weapon";
		const system = (item.system ?? {}) as DamageSource["system"];
		const base: AttackProfile = {
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
		// Launchers fire LOADED ordnance (bead 4obp): the base weapon profile
		// (damage "—") is replaced by the loaded item's fire profile, or
		// marked unusable when nothing usable is loaded.
		if (
			!melee &&
			String(
				((item.system ?? {}) as { weaponFamily?: string }).weaponFamily ?? "",
			).toLowerCase() === LAUNCHER_FAMILY
		) {
			return launcherProfile(
				base,
				String(
					((item.system ?? {}) as { loadedAmmoId?: string }).loadedAmmoId ??
						"",
				),
				ammoResolver,
			);
		}
		return base;
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
