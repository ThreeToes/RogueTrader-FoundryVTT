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
import { itemTaxonomyRegistry, requireDeclaredItemType } from "./taxonomy-registry";

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
 * Structural view of an ATTACHED weapon-modification item (bead huaf/ujtg):
 * the profile fold reads only its profile-changing effect rows (kinds
 * "pen-flat" / "primitive-clear" on `system.effects`) — the same EffectData
 * row grammar the editor authors. Deliberately structural; attack.ts stays
 * Foundry-free.
 */
export interface AttachedWeaponMod {
	id?: string | null;
	name?: string;
	system?: {
		effects?: Array<{
			kind?: string;
			value?: number;
			label?: string;
		}>;
	};
}

/** The effect kinds an attached weapon mod can feed the fire profile. */
export const WEAPON_MOD_EFFECT_KINDS = ["pen-flat", "primitive-clear"] as const;

/**
 * Actor-side lookup for one attached modification: `(id) => actor.items.get(id)`
 * — the SAME resolver instance as the ammo one (both resolve owned item ids).
 */
export type ModResolver = (id: string) => AttachedWeaponMod | null | undefined;

/**
 * Resolve a weapon's attached modification ids (system.modifications) through
 * the optional resolver; nulls/misses drop silently (a deleted mod item
 * degrades to “not attached”, never a crash) — the sheet re-syncs dangling
 * ids at install time.
 */
function weaponModSources(
	item: AttackSource | null | undefined,
	modsResolver?: ModResolver,
): AttachedWeaponMod[] {
	if (!modsResolver) return [];
	const ids =
		((item?.system ?? {}) as { modifications?: string[] }).modifications ?? [];
	return ids
		.map((id) => modsResolver(String(id)))
		.filter((mod): mod is AttachedWeaponMod => Boolean(mod));
}

/**
 * The weapon-mods fold (bead huaf/ujtg): fold the attached modifications'
 * profile-changing effect rows into the base profile. Only the registered
 * WEAPON_MOD_EFFECT_KINDS apply — everything else on a mod is display text
 * until the effect machinery grows the kind (owner: mods must be VISIBLE, and
 * unmodelled ones must not pretend to be mechanical). Mods apply to THIS
 * weapon only; the engine's actor-level collection ignores
 * weapon-modification rows (they are on no liveness table), so a mod can
 * never double-count.
 */
function foldWeaponMods(
	base: AttackProfile,
	mods: AttachedWeaponMod[] | null | undefined,
): AttackProfile {
	if (!mods || mods.length === 0) return base;
	let penetration = base.penetration;
	let primitive = base.primitive;
	let qualities = base.qualities;
	for (const mod of mods) {
		for (const row of mod.system?.effects ?? []) {
			if (row.kind === "pen-flat" && Number.isFinite(row.value)) {
				penetration += Number(row.value);
			}
			if (row.kind === "primitive-clear") {
				primitive = false;
				// Mono makes the weapon count non-primitive for the qualities
				// list too (the primitive-armour rule reads either form.
				// Pure fold — never mutate the caller's profile object).
				qualities = qualities.filter((q) => q.toLowerCase() !== "primitive");
			}
		}
	}
	return { ...base, penetration, primitive, qualities };
}

/**
 * The weaponFamily key the load model gates on (epic nlsh): launchers fire
 * LOADED ordnance — missiles (ammunition items) or grenades (thrown-family
 * ranged-weapon items). Launchers WITH an acceptsAmmo key carry the printed
 * "—" damage and have no profile of their own; launchers WITHOUT one carry
 * their own COMPLETE printed profile and fire standalone (bead pht2 — Core
 * Rulebook p114: default ammunition is an abstract included supply, only
 * UNUSUAL ammo is itemised and loadable).
 */
export const LAUNCHER_FAMILY = "launcher";

/**
 * The registry of launcher-ordnance kinds (bead mnrm): what `acceptsAmmo`
 * keys and `ordnance.kind` values name. "mortar" is reserved for the mortar
 * loading follow-up (Into the Storm p116-117: the Minefield/Scatter/Starflare
 * rounds are also book-legal there, but mortars carry no load machinery yet).
 * NOT a hard enum: a homebrew launcher/kind stays data-driven (same
 * explicit-open posture as `acceptsAmmo` itself) — this is the documented
 * vocabulary, and `ordnanceKindsOf` parses any kind string against it.
 */
export const ORDNANCE_KINDS: readonly string[] = ["missile", "grenade"];

/**
 * EVERY ordnance kind a candidate item supplies (bead mnrm), as a list:
 *   - ammunition items carry the structured `ordnance` block — the kinds are
 *     the block's own `kind`: normally ONE kind ("missile"), but a round whose
 *     book reading is ambiguous may author a WHITESPACE-SEPARATED LIST
 *     ("grenade missile") and load into ANY launcher naming one of them —
 *     e.g. the Starflare Round (Into the Storm p116-117: the prose first
 *     sentence permits "missile launcher or grenade launcher", the restriction
 *     line names "mortar or grenade launchers (not missile launchers)")
 *     — owner ruling 2026-10-04: both readings permitted; individual GMs
 *     arbitrate book-vs-table at their table;
 *   - grenade weapons STAY ranged-weapon items (hand-throwable) — the kind is
 *     "grenade", carried by the item being in the book's thrown family
 *     (class or weaponFamily "thrown"); the launcher reads their EXISTING
 *     weapon fields. The book's grenade rows sit in the thrown family
 *     (Table 5-6); launcher-firable grenades keep class/weaponFamily thrown.
 *   - grenade-kind AMMUNITION (a kind value of "grenade" on an ordnance
 *     block) is also accepted by "grenade" launchers: a grenade launcher
 *     firing an unusual grenade round is book-consistent.
 * Anything else — plain ammunition, pistols, raw gear — is not ordnance: [].
 */
export function ordnanceKindsOf(item: LoadableOrdnance): string[] {
	if (item.type === "ammunition") {
		const block = item.system?.ordnance;
		// The block's KIND(S) are the load compatibility (bead pht2/mnrm): the
		// book prints "—" Dam for no-damage rounds too (Web Missile, Hostile
		// Acquisitions Table 2-11 p52), so damage is NOT part of the gate —
		// FIELDS still require it (ordnanceFieldsOf: a damageless load stays
		// warn-and-refuse, like the established damage-less grenade case).
		const kinds = String(block?.kind ?? "")
			.trim()
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		return [...new Set(kinds)];
	}
	if (item.type === "ranged-weapon") {
		const sys = item.system ?? {};
		const klass = String(sys.class ?? "").toLowerCase();
		const family = String(sys.weaponFamily ?? "").toLowerCase();
		return klass === "thrown" || family === "thrown" ? ["grenade"] : [];
	}
	return [];
}

/**
 * The PRIMARY (single-kind) family of a candidate item — `ordnanceKindsOf`'s
 * first kind, or null when the item supplies no ordnance. A multi-kind round
 * has no single kind here (its first authored kind stands in); load
 * COMPATIBILITY never reads this — it gates on `acceptsOrdnance` membership
 * over the full kinds list (bead mnrm).
 */
export function ordnanceFamilyOf(item: LoadableOrdnance): string | null {
	return ordnanceKindsOf(item)[0] ?? null;
}

/**
 * May `candidate` be loaded into `launcher`? The launcher names its accepted
 * kind in `acceptsAmmo` ("missile" / "grenade"); an empty acceptance means it
 * accepts nothing (explicit, homebrew-friendly — epic nlsh launcher-
 * compatibility card). The gate is MEMBERSHIP over the candidate's full
 * kinds list (ordnanceKindsOf, bead mnrm): a two-kind round loads into any
 * launcher naming one of its kinds; single-kind rounds behave exactly as
 * before (equality is membership on a one-element list).
 */
export function acceptsOrdnance(
	launcher: { system?: { acceptsAmmo?: string } },
	candidate: LoadableOrdnance,
): boolean {
	const accepts = String(launcher.system?.acceptsAmmo ?? "")
		.trim()
		.toLowerCase();
	if (!accepts) return false;
	return ordnanceKindsOf(candidate).includes(accepts);
}

/**
 * The profile fields a loaded ordnance item supplies (bead 4obp): the branch
 * DISPATCHES on the loaded item's TYPE — ammunition resolves its `ordnance`
 * block; a grenade weapon resolves its own unchanged weapon fields.
 * Returns null when the item supplies nothing usable (missing document,
 * plain ammunition, a damage-less grenade) — that is the warn-and-refuse
 * case, never a silent fallback to the launcher's own "—" damage.
 */
export function ordnanceFieldsOf(loaded: LoadableOrdnance | null | undefined): {
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
 * A weapon resolves from its own system data — except a LAUNCHER WITH
 * `acceptsAmmo` (bead 4obp): its fire profile derives from the loaded
 * ordnance through the optional actor-side `ammoResolver`, and unloaded it
 * yields an unusable profile the damage path refuses (the book prints "—"
 * for launcher damage there — "Varies with ammunition"). A launcher WITHOUT
 * `acceptsAmmo` (bead pht2) carries its own COMPLETE printed profile and
 * resolves as a normal ranged weapon: Core Rulebook p114 makes default
 * ammunition an ABSTRACT included supply, and Into the Storm p113 prose
 * forbids unusual ammo on these launchers — there is nothing to load, so
 * no load machinery and no warn apply.
 *
 * A mutation resolves ONLY from an authored `attack` block — a mutation
 * without one is not an attack, however combat-flavoured its prose.
 * Anything else DECLARED returns null, and an UNDECLARED (foreign) item type
 * throws a RangeError naming it (bead cmio.5): which types carry an intrinsic
 * attack is the ACTIVE system's registry data (model/taxonomy-registry.ts),
 * so a sibling system's types must never quietly resolve as "no attack".
 *
 * Explicit contract (bead 6l68, tested in attack.test.ts): a null/undefined
 * item yields null — the tolerance exists so callers can gate the document
 * lookup separately and MUST NOT lean on it for their own null checks. A
 * blank type yields null under the same tolerance (an item without a type
 * has no attack); a NON-blank undeclared type is a loud refusal.
 */
export function attackProfileOf(
	item: AttackSource | null | undefined,
	ammoResolver?: AmmoResolver,
	modsResolver?: ModResolver,
): AttackProfile | null {
	if (!item) return null;
	const type = (item.type ?? "") as string;
	// Bead cmio.5: a foreign item type is refused BY NAME — never silently
	// resolved as "carries no attack". Declared types proceed; the weapon and
	// intrinsic-attack gates below are the ACTIVE system's registry data.
	if (type) requireDeclaredItemType(type);
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
		// Launchers (bead 4obp): a launcher WITH acceptsAmmo fires LOADED
		// ordnance — the base weapon profile (damage "—") is replaced by the
		// loaded item's fire profile, or marked unusable when nothing usable
		// is loaded. WITHOUT acceptsAmmo (bead pht2) the launcher is a
		// standalone weapon: its own printed profile wins, and nothing load
		// side is consulted (the empty acceptance means it accepts nothing —
		// epic nlsh compatibility card).
		// Attached weapon modifications (bead huaf/ujtg) fold into EVERY
		// branch — install is not launcher-gated, so a missed fold would be a
		// silent no-op (review finding, epic zlwc round 3).
		const attachedMods = weaponModSources(item, modsResolver);
		if (
			!melee &&
			String(
				((item.system ?? {}) as { weaponFamily?: string }).weaponFamily ?? "",
			).toLowerCase() === LAUNCHER_FAMILY
		) {
			const accepts = String(
				((item.system ?? {}) as { acceptsAmmo?: string }).acceptsAmmo ?? "",
			)
				.trim()
				.toLowerCase();
			if (!accepts) return foldWeaponMods(base, attachedMods);
			return foldWeaponMods(
				launcherProfile(
					base,
					String(
						((item.system ?? {}) as { loadedAmmoId?: string }).loadedAmmoId ??
							"",
					),
					ammoResolver,
				),
				attachedMods,
			);
		}
		return foldWeaponMods(base, attachedMods);
	}
	// The non-weapon intrinsic attacks resolve from an authored `attack` block.
	// WHICH types those are is the ACTIVE system's registry data (bead cmio.5):
	// for RT this is "mutation" — Corrosive Bile, Core Rulebook p369 — exactly
	// the literal this used to be, moved, not re-designed.
	if (!itemTaxonomyRegistry().intrinsicAttackTypes.includes(type)) return null;
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
		attackType:
			attack.characteristic === "ws" ? "melee-weapon" : "ranged-weapon",
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
