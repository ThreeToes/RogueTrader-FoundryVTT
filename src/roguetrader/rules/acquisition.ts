/**
 * Acquisition rules (bead gjvg, Core Rulebook p271-273 = book pages 146-148 and
 * Table 1-5 p33).
 *
 * An Acquisition Test is a 1d100 roll against the group's Profit Factor,
 * modified by the item's Availability, the scale of the request, and its
 * Craftsmanship (Table 9-35). Bonuses raising the effective target to 100+
 * succeed automatically; penalties reducing it to 0 or less fail
 * automatically. Everything here is pure; Foundry coupling stays in the UI.
 */

/** Table 9-35: Acquisition Modifiers (availability ladder). */
export const AVAILABILITY_MODIFIERS: Readonly<Record<string, number>> = {
	ubiquitous: 70,
	abundant: 50,
	plentiful: 30,
	common: 20,
	average: 10,
	scarce: 0,
	rare: -10,
	"very-rare": -20,
	"extremely-rare": -30,
	"near-unique": -50,
	unique: -70,
};

/** Table 9-35 scale modifiers (named scales; numeric quantities map below). */
export const SCALE_MODIFIERS: Readonly<Record<string, number>> = {
	negligible: 30,
	trivial: 20,
	minor: 10,
	standard: 0,
	major: -10,
	significant: -20,
	vast: -30,
};

/** Table 9-35 craftsmanship modifiers. */
export const CRAFTSMANSHIP_MODIFIERS: Readonly<Record<string, number>> = {
	poor: 10,
	common: 0,
	good: -10,
	best: -30,
};

/** Table 1-5: Starting Profit Factor and Ship Points (p33, 1d10). */
export function startingProfitFactorAndShipPoints(roll: number): {
	profitFactor: number;
	shipPoints: number;
} {
	const r = Math.min(10, Math.max(1, roll));
	if (r === 1) return { profitFactor: 60, shipPoints: 30 };
	if (r <= 3) return { profitFactor: 50, shipPoints: 40 };
	if (r <= 7) return { profitFactor: 40, shipPoints: 50 };
	if (r <= 9) return { profitFactor: 30, shipPoints: 60 };
	return { profitFactor: 20, shipPoints: 70 };
}

export interface AcquisitionContext {
	profitFactor: number;
	availabilityModifier?: number;
	scaleModifier?: number;
	craftsmanshipModifier?: number;
	/** Any additional situational modifiers (rare access talents, etc.). */
	extra?: number;
}

export interface AcquisitionEvaluation {
	/** Profit Factor + total modifiers. */
	target: number;
	modifiers: number;
	/** "success" / "failure" when the test resolves without a roll. */
	automatic: "success" | "failure" | null;
}

/** Effective acquisition target + auto success/failure band (p272-273). */
export function acquisitionTarget(
	context: AcquisitionContext,
): AcquisitionTargetResult {
	const modifiers =
		(context.availabilityModifier ?? 0) +
		(context.scaleModifier ?? 0) +
		(context.craftsmanshipModifier ?? 0) +
		(context.extra ?? 0);
	const target = context.profitFactor + modifiers;
	const automatic = target >= 100 ? "success" : target <= 0 ? "failure" : null;
	return { target, modifiers, automatic };
}

export type AcquisitionTargetResult = {
	target: number;
	modifiers: number;
	automatic: "success" | "failure" | null;
};

/** Resolve a rolled Acquisition Test (1d100 roll vs target). */
export function resolveAcquisition(
	context: AcquisitionContext,
	roll: number,
): AcquisitionTargetResult & { success: boolean } {
	const base = acquisitionTarget(context);
	const automatic = base.automatic;
	const success =
		automatic === "success"
			? true
			: automatic === "failure"
				? false
				: roll <= base.target;
	return { ...base, success };
}

/** Modifier for an item availability string (unknown -> null, never guess). */
export function availabilityModifier(availability: string): number | null {
	return AVAILABILITY_MODIFIERS[availability] ?? null;
}

/**
 * Weapon-family coverage (bead erzk, Core Rulebook printed pp272, 95,
 * 100, 104-105). Each Weapon Training category has explicit Talent Groups
 * plus a "Universal" group with the book-defined membership, quoted from
 * the talent descriptions:
 * - Basic Weapon Training: "Talent Groups: Bolt, Las, Launcher, Primitive,
 *   SP, Universal" — "The Universal group includes the Bolt, Las,
 *   Launcher, Melta, Plasma, and SP groups."
 * - Pistol Weapon Training: "Talent Groups: Primitive, Universal" —
 *   "The Universal group confers proficiency with most pistol weapons,
 *   including the Bolt, Las, Launcher, Melta, Plasma, and SP groups."
 * - Heavy Weapon Training: "Talent Groups: Bolt, Flame, Las, Launcher,
 *   Melta, Plasma, Primitive, and SP" (no Universal group).
 * - Melee Weapon Training: "Talent Groups: Primitive, Universal" — "The
 *   universal group includes the Chain, Shock, and Power groups."
 * - Thrown Weapon Training: "Talent Groups: Universal" (thrown weapons
 *   only).
 * - Exotic Weapon Proficiency: "Talent Groups: All Exotic Weapons" —
 *   per-weapon, matched against the weapon's name.
 * Without the correct Weapon Training Talent the wielder suffers a –20
 * penalty on relevant WS/BS Tests — the creator's starting-acquisition
 * gate (printed p272 bullet 2) enforces this at selection time.
 */
export interface WeaponTrainingCoverage {
	/** Weapon-training categories held (basic/pistol/heavy/melee/thrown). */
	classes: Set<string>;
	/** Per-category family coverage (families usable within that category). */
	byCategory: Record<string, Set<string>>;
	/** Exotic Weapon Proficiency subjects, lowercased for name matching. */
	exotic: Set<string>;
}

/**
 * The Weapon Training talent groups the book sells per category (the
 * "Talent Groups:" lines quoted above; Universal is its own sold talent
 * whose membership is `universal`). A specific talent (e.g. "Basic Weapon
 * Training (Las)") covers exactly its parenthetical family.
 */
const TRAINING_GROUPS: Readonly<
	Record<
		string,
		{ groups: ReadonlyArray<string>; universal: ReadonlyArray<string> }
	>
> = {
	basic: {
		groups: ["bolt", "las", "launcher", "primitive", "sp"],
		universal: ["bolt", "las", "launcher", "melta", "plasma", "sp"],
	},
	pistol: {
		groups: ["primitive"],
		universal: ["bolt", "las", "launcher", "melta", "plasma", "sp"],
	},
	heavy: {
		groups: [
			"bolt",
			"flame",
			"las",
			"launcher",
			"melta",
			"plasma",
			"primitive",
			"sp",
		],
		universal: [],
	},
	melee: {
		groups: ["primitive"],
		universal: ["chain", "shock", "power"],
	},
	thrown: { groups: [], universal: ["thrown"] },
};

/** The five weapon classes (weapon-class.ts WeaponClass values). */
export const WEAPON_CLASSES = [
	"melee",
	"thrown",
	"pistol",
	"basic",
	"heavy",
] as const;

/** Talent-group spellings -> weapon-family registry keys. */
const FAMILY_ALIASES: Record<string, string> = {
	"solid projectile": "sp",
};

/**
 * Resolve the weapon families a character can use from their Weapon
 * Training talents, per training category (basic/pistol/heavy/melee/
 * thrown). `exotic` collects per-weapon Exotic Weapon Proficiency
 * subjects, lowercased.
 */
export function weaponTrainingCoverage(
	talentNames: ReadonlyArray<string>,
): WeaponTrainingCoverage {
	const classes = new Set<string>();
	const byCategory: Record<string, Set<string>> = {};
	const exotic = new Set<string>();
	for (const raw of talentNames) {
		const name = String(raw);
		if (/exotic weapon proficiency/i.test(name)) {
			const subject = /\(([^)]+)\)/.exec(name)?.[1];
			if (subject) exotic.add(subject.toLowerCase());
			continue;
		}
		const category =
			/\bpistol\b|\bbasic\b|\bheavy\b|\bmelee\b|\bthrown\b/i.exec(
				/weapon training/i.test(name) ? name : "",
			);
		if (!category) continue;
		const key = category[0].toLowerCase();
		const groups = TRAINING_GROUPS[key];
		classes.add(key);
		const covered = (byCategory[key] ??= new Set<string>());
		const parenthetical = /\(([^)]+)\)/.exec(name)?.[1] ?? "";
		if (/\buniversal\b/i.test(parenthetical) || !parenthetical) {
			// The Universal group is its own book-defined membership (it does
			// not stack with the category's sold groups). A talent with no
			// parenthetical is treated as Universal (authoring variance).
			const families = groups.universal.length
				? groups.universal
				: groups.groups;
			for (const family of families) covered.add(family);
		} else {
			for (const raw of parenthetical.split(/[,/]/)) {
				const family = raw.trim().toLowerCase();
				if (!family) continue;
				// Book spellings -> registry keys ("SP", "Las", "Launcher"...).
				covered.add(
					FAMILY_ALIASES[family.toLowerCase()] ?? family.toLowerCase(),
				);
			}
		}
	}
	return { classes, byCategory, exotic };
}

/**
 * Is the character trained for the given weapon? (Core Rulebook printed
 * p272 bullet 2 + p95: without the matching Weapon Training Talent the
 * wielder suffers a –20 penalty on relevant WS/BS Tests.)
 *
 * - Exotic weapons require a matching Exotic Weapon Proficiency subject
 *   (name match — the proficiency is per-weapon, "All Exotic Weapons").
 * - Thrown-class weapons are covered by Thrown Weapon Training (Universal
 *   only), or by Melee training covering the weapon's family (a thrown
 *   Primitive knife is also a Melee Primitive weapon).
 * - Everything else requires the weapon's family within the matching
 *   category's coverage.
 * - Weapons with no family authored fall back to the class-level gate
 *   (pre-erzk behaviour) so un-curated homebrew items still work.
 */
export function isTrainedFor(
	coverage: WeaponTrainingCoverage,
	weapon: {
		class?: string;
		weaponFamily?: string;
		name?: string;
	},
): boolean {
	const klass = String(weapon.class ?? "").toLowerCase();
	const family = String(weapon.weaponFamily ?? "").toLowerCase();
	if (family === "exotic") {
		const name = String(weapon.name ?? "").toLowerCase();
		for (const subject of coverage.exotic) {
			if (subject && name.includes(subject)) return true;
		}
		return false;
	}
	if (klass === "thrown") {
		if (coverage.classes.has("thrown")) return true;
		const family_ = String(weapon.weaponFamily ?? "").toLowerCase();
		if (family_ && coverage.byCategory.melee?.has(family_)) return true;
		return false;
	}
	if (family) return coverage.byCategory[klass]?.has(family) ?? false;
	return coverage.classes.has(klass);
}

/**
 * Weapon classes covered by a character's Weapon Training talents (Core
 * Rulebook printed p272, "Acquisition and Starting Characters" bullet 2:
 * "In the case of weapons, a character may only choose those which he can
 * use. i.e., he must have a corresponding Weapon Training Talent.").
 *
 * "(Universal)" covers every class of that training's category (the book
 * sells Pistol/Basic/Heavy/Melee/Thrown Weapon Training (Universal)). A
 * specific-family talent (e.g. "Basic Weapon Training (Las)") only truly
 * covers its families — the weapon schema has no family field, so this is
 * enforced at CLASS level: a matching-class specific talent covers the
 * class. Empty/blank talent lists return an empty set (nothing covered).
 */
export function coveredWeaponClasses(
	talentNames: ReadonlyArray<string>,
): Set<string> {
	const covered = new Set<string>();
	for (const raw of talentNames) {
		const name = String(raw);
		if (!/weapon training|weapon proficiency/i.test(name)) continue;
		const universal = /\buniversal\b/i.test(name);
		const matches = name.match(
			/\bpistol\b|\bbasic\b|\bheavy\b|\bmelee\b|\bthrown\b/gi,
		);
		if (matches) {
			for (const match of matches) covered.add(match.toLowerCase());
		} else if (universal) {
			// Universal with no stated category (authoring variance) — treat
			// as covering everything rather than dropping the talent.
			for (const klass of WEAPON_CLASSES) covered.add(klass);
		}
	}
	return covered;
}
