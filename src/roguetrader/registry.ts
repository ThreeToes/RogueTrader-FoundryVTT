/**
 * Runtime-open registries for content-classifiers (body locations, weapon
 * qualities, protection types, ...).
 *
 * The system seeds each registry with core content; modules that extend the
 * system register additional entries during their init hook:
 *
 * ```js
 * Hooks.once("init", () => {
 *   CONFIG.ROGUE_TRADER.qualities.register("overload", "QUALITY.OVERLOAD");
 * });
 * ```
 *
 * Registries must be populated before the first DataModel schema is built
 * (i.e. during `init`). Schema field `choices` are captured at that point.
 */
import { Registry } from "../ffg/domain/registry";

/**
 * A `Registry<string>` of key -> i18n label key, plus the `choices` shape
 * Foundry's `StringField#choices` and `selectOptions` expect. The generic
 * registry primitive lives in domain/registry.ts (epic kof0, phase 5).
 */
export class EntryRegistry extends Registry<string> {
	/** Choices shape expected by `StringField#choices` and `selectOptions`. */
	get choices(): Record<string, string> {
		return Object.fromEntries(this.entries());
	}
}

/**
 * Characteristic labels in the SHORT form ("CHARACTERISTIC.WS"), which is
 * what the skill/power pickers render. The vocabulary itself is
 * CHARACTERISTIC_KEYS (domain/model/taxonomy).
 */
const CHARACTERISTIC_LABELS = {
	ws: "CHARACTERISTIC.WS",
	bs: "CHARACTERISTIC.BS",
	s: "CHARACTERISTIC.S",
	t: "CHARACTERISTIC.T",
	ag: "CHARACTERISTIC.AG",
	int: "CHARACTERISTIC.INT",
	per: "CHARACTERISTIC.PER",
	wp: "CHARACTERISTIC.WP",
	fel: "CHARACTERISTIC.FEL",
} as const;

/**
 * The same characteristics in the DESCRIPTIVE form
 * ("CHARACTERISTIC.WEAPON_SKILL"), used by the item effect editor's
 * test-key dropdown. Deliberately a separate registry: the short and long
 * forms are different translations in es/fr/pl, so they must not be merged.
 */
const CHARACTERISTIC_LONG_LABELS = {
	ws: "CHARACTERISTIC.WEAPON_SKILL",
	bs: "CHARACTERISTIC.BALLISTIC_SKILL",
	s: "CHARACTERISTIC.STRENGTH",
	t: "CHARACTERISTIC.TOUGHNESS",
	ag: "CHARACTERISTIC.AGILITY",
	int: "CHARACTERISTIC.INTELLIGENCE",
	per: "CHARACTERISTIC.PERCEPTION",
	wp: "CHARACTERISTIC.WILLPOWER",
	fel: "CHARACTERISTIC.FELLOWSHIP",
} as const;

const BODY_LOCATIONS = {
	head: "BODY_LOCATION.HEAD",
	body: "BODY_LOCATION.BODY",
	"left-arm": "BODY_LOCATION.LEFT_ARM",
	"right-arm": "BODY_LOCATION.RIGHT_ARM",
	"left-leg": "BODY_LOCATION.LEFT_LEG",
	"right-leg": "BODY_LOCATION.RIGHT_LEG",
} as const;

/**
 * Body locations in the armour panels' display order (head first, then the
 * symmetric limb/body pairs). The vocabulary itself is BODY_LOCATIONS;
 * this is the rendering order the PC and NPC armour panels use.
 */
export const BODY_LOCATION_ORDER = [
	"head",
	"left-arm",
	"body",
	"right-arm",
	"left-leg",
	"right-leg",
] as const;

/**
 * Core weapon qualities. Extend freely via the registry; this seed is not
 * exhaustive - edit here or register from a module.
 */
const QUALITIES = {
	accurate: "QUALITY.ACCURATE",
	balanced: "QUALITY.BALANCED",
	blast: "QUALITY.BLAST",
	burning: "QUALITY.BURNING",
	cheap: "QUALITY.CHEAP",
	cleansingFire: "QUALITY.CLEANSING_FIRE",
	corrosive: "QUALITY.CORROSIVE",
	defensive: "QUALITY.DEFENSIVE",
	flexible: "QUALITY.FLEXIBLE",
	force: "QUALITY.FORCE",
	gyroStabilised: "QUALITY.GYRO_STABILISED",
	flame: "QUALITY.FLAME",
	inaccurate: "QUALITY.INACCURATE",
	overheats: "QUALITY.OVERHEATS",
	// Tau Character Guide p28: an Overcharge (X) weapon may raise its Damage
	// by X for a shot, but gains the Overheats quality for those shots.
	overcharge: "QUALITY.OVERCHARGE",
	powerField: "QUALITY.POWER_FIELD",
	powerful: "QUALITY.POWERFUL",
	primitive: "QUALITY.PRIMITIVE",
	recharge: "QUALITY.RECHARGE",
	reliable: "QUALITY.RELIABLE",
	sanctified: "QUALITY.SANCTIFIED",
	scatter: "QUALITY.SCATTER",
	shocking: "QUALITY.SHOCKING",
	smoke: "QUALITY.SMOKE",
	snare: "QUALITY.SNARE",
	stun: "QUALITY.STUN",
	// Soul Reaver Ch IV new qualities (bead dfb8, printed p108). Crippling,
	// Felling and Proven are parameterised in book notation — author them as
	// "crippling-1d5", "felling-1", "proven-3" etc. in the special list.
	crippling: "QUALITY.CRIPPLING",
	felling: "QUALITY.FELLING",
	proven: "QUALITY.PROVEN",
	razorSharp: "QUALITY.RAZOR_SHARP",
	storm: "QUALITY.STORM",
	tearing: "QUALITY.TEARING",
	toxic: "QUALITY.TOXIC",
	unbalanced: "QUALITY.UNBALANCED",
	unreliable: "QUALITY.UNRELIABLE",
	unstable: "QUALITY.UNSTABLE",
	unwieldy: "QUALITY.UNWIELDY",
	volatile: "QUALITY.VOLATILE",
	// Navis Primer Ch V (bead g0vv): Culexus Animus Speculum and daemon
	// weapons carry the Warp Weapon quality — damage doubles vs psykers,
	// Daemons, and psychically active creatures.
	warpWeapon: "QUALITY.WARP_WEAPON",
} as const;

const PROTECTION_TYPES = {
	primitive: "PROTECTION_TYPE.PRIMITIVE",
	"non-primitive": "PROTECTION_TYPE.NON_PRIMITIVE",
} as const;

/**
 * Tau battlesuit system categories (Tau Character Guide printed pp31-38).
 * The order is the book's own and matters: Primary Systems are integral to the
 * suit, Support and Weapon Systems are what Hard Points are spent on, and
 * Signature Systems are the experimental Unique tier — which is exactly how
 * Table 1-5: Battlesuit Critical Effects refers to them.
 */
const BATTLESUIT_SYSTEM_CATEGORIES = {
	primary: "BATTLESUIT_SYSTEM.CATEGORY_PRIMARY",
	support: "BATTLESUIT_SYSTEM.CATEGORY_SUPPORT",
	signature: "BATTLESUIT_SYSTEM.CATEGORY_SIGNATURE",
	weapon: "BATTLESUIT_SYSTEM.CATEGORY_WEAPON",
} as const;

/**
 * Core vehicle classes. Extend freely via the registry; this seed is not
 * exhaustive - edit here or register from a module.
 */
const VEHICLE_CLASSES = {
	ground: "VEHICLE_CLASS.GROUND",
	tracked: "VEHICLE_CLASS.TRACKED",
	hovering: "VEHICLE_CLASS.HOVERING",
	flying: "VEHICLE_CLASS.FLYING",
	walker: "VEHICLE_CLASS.WALKER",
	watercraft: "VEHICLE_CLASS.WATERCRAFT",
	voidcraft: "VEHICLE_CLASS.VOIDCRAFT",
} as const;

/**
 * Armour facings for vehicles. Keys become `Vehicle.armour` record keys the
 * same way body locations key `Armour.armourPoints`.
 */
const VEHICLE_FACINGS = {
	front: "VEHICLE_FACING.FRONT",
	left: "VEHICLE_FACING.LEFT",
	right: "VEHICLE_FACING.RIGHT",
	rear: "VEHICLE_FACING.REAR",
	top: "VEHICLE_FACING.TOP",
	bottom: "VEHICLE_FACING.BOTTOM",
} as const;

/**
 * Weapon families (bead erzk): the book's Weapon Training talent groups
 * (Core Rulebook printed p95/p100/p104-105, "Talent Groups:") plus the
 * ranged/melee weapon-table sections (Table 5-3/5-4 headings). These key
 * Weapon.weaponFamily, the field the Weapon Training gate resolves
 * against — "he must have a corresponding Weapon Training Talent".
 * Thrown is a family key for grenade/missile-class rows (Thrown Weapon
 * Training sells only a Universal group).
 */
const WEAPON_FAMILIES = {
	las: "WEAPON_FAMILY.LAS",
	sp: "WEAPON_FAMILY.SP",
	bolt: "WEAPON_FAMILY.BOLT",
	melta: "WEAPON_FAMILY.MELTA",
	plasma: "WEAPON_FAMILY.PLASMA",
	flame: "WEAPON_FAMILY.FLAME",
	launcher: "WEAPON_FAMILY.LAUNCHER",
	primitive: "WEAPON_FAMILY.PRIMITIVE",
	chain: "WEAPON_FAMILY.CHAIN",
	power: "WEAPON_FAMILY.POWER",
	shock: "WEAPON_FAMILY.SHOCK",
	exotic: "WEAPON_FAMILY.EXOTIC",
	thrown: "WEAPON_FAMILY.THROWN",
} as const;

/** Core vehicle traits. Extend freely via the registry. */
const VEHICLE_TRAITS = {
	"open-topped": "VEHICLE_TRAIT.OPEN_TOPPED",
	amphibious: "VEHICLE_TRAIT.AMPHIBIOUS",
	reinforced: "VEHICLE_TRAIT.REINFORCED",
	hovering: "VEHICLE_TRAIT.HOVERING",
	armoured: "VEHICLE_TRAIT.ARMOURED",
	commandVehicle: "VEHICLE_TRAIT.COMMAND_VEHICLE",
	surveyorOptics: "VEHICLE_TRAIT.SURVEYOR_OPTICS",
} as const;

/**
 * Named vehicle system slots (drive, auspex/sensors, weapons mounts...).
 * Keys are canonical slot names; modules may register additional slots.
 */
const VEHICLE_SYSTEMS = {
	drive: "VEHICLE_SYSTEM.DRIVE",
	sensors: "VEHICLE_SYSTEM.SENSORS",
	powerPlant: "VEHICLE_SYSTEM.POWER_PLANT",
	"weapons-mount": "VEHICLE_SYSTEM.WEAPONS_MOUNT",
} as const;

/**
 * Core talent categories (best-effort RT structure, VERIFY grouping against
 * the core book before expanding the catalog).
 */
/**
 * Item equip states (item-side carrying model). Weapons use carried as the
 * ready state; armour uses worn; modules may register further states.
 */
const EQUIP_STATES = {
	stowed: "EQUIP_STATE.STOWED",
	carried: "EQUIP_STATE.CARRIED",
	worn: "EQUIP_STATE.WORN",
} as const;

const TALENT_CATEGORIES = {
	background: "TALENT_CATEGORY.BACKGROUND",
	defence: "TALENT_CATEGORY.DEFENCE",
	offence: "TALENT_CATEGORY.OFFENCE",
	psychic: "TALENT_CATEGORY.PSYCHIC_RELATED",
	social: "TALENT_CATEGORY.SOCIAL",
	wilderness: "TALENT_CATEGORY.WILDERNESS",
} as const;

/**
 * Seed of best-remembered RT core talents (best-effort names, flag for
 * terminology review). Extend freely via the registry.
 */
const TALENTS = {
	ambidextrous: "TALENT.AMBIDEXTROUS",
	deadeyeShot: "TALENT.DEADEYE_SHOOTER",
	eagerForDanger: "TALENT.EAGER_FOR_DANGER",
	frenzy: "TALENT.FRENZY",
	furiousAssault: "TALENT.FURIOUS_ASSAULT",
	hardened: "TALENT.HARDENED",
	hipShooting: "TALENT.HIP_SHOOTING",
	rapidReload: "TALENT.RAPID_RELOAD",
	resistanceFear: "TALENT.RESISTANCE_FEAR",
	soundConstitution: "TALENT.SOUND_CONSTITUTION",
	sprint: "TALENT.SPRINT",
	totalRecall: "TALENT.TOTAL_RECALL",
	pistolTraining: "TALENT.PISTOL_TRAINING",
} as const;

/**
 * Guarded test-modifier conditions (bead czx): keys a talent effect's
 * `condition` field can reference; the funnel evaluates them against the
 * TestModifierContext flags. Seed is not exhaustive - extend via the
 * registry or modules.
 */
const TALENT_CONDITIONS = {
	charging: "CONDITION.CHARGING",
	frenzied: "CONDITION.FRENZIED",
	aimed: "CONDITION.AIMED",
	opposed: "CONDITION.OPPOSED",
	// Bead jpbm: fear tests set the context flag "fear" (roll-system), so
	// authored effects like Resistance (Fear) +10 gate on it. Distinct i18n
	// key from the CONDITION.FEAR status-condition label.
	fear: "CONDITION.FEAR_TESTS",
	// Affliction conditions (bead xu83): the madness/mutation packs print
	// situational penalties and bonuses ("in bright light", "with strangers",
	// "while nauseated", "vs poison", "with 'normals'"). Each key is offered
	// as a pre-roll toggle in the TestDialog by rules/funnel.ts
	// collectConditionKeys, so the guard is visible rather than silent.
	brightlight: "CONDITION.BRIGHT_LIGHT",
	strangers: "CONDITION.STRANGERS",
	normals: "CONDITION.NORMALS",
	nauseated: "CONDITION.NAUSEATED",
	poison: "CONDITION.POISON_TESTS",
} as const;

/**
 * Acquisition-time affliction procedures (bead xu83). Some mutations print a
 * bespoke one-off procedure that cannot be expressed as a static effect row
 * (Degenerate Mind's 1d10 trait pick; Mental Regressive's per-characteristic
 * d10 table). The mutation item names the procedure in `system.procedure`;
 * rules/afflictions.ts implements it and runs it once when the Item is
 * acquired. Unknown values throw (never silently ignore a printed rule).
 */
const AFFLICTION_PROCEDURES = {
	"degenerate-mind": "PROCEDURE.DEGENERATE_MIND",
	"mental-regressive": "PROCEDURE.MENTAL_REGRESSIVE",
	// Ravaged Body (Core Rulebook p369) rolls 1d5 further mutations instead of
	// settling rows on itself, so its handler returns grant names (kam1).
	"ravaged-body": "PROCEDURE.RAVAGED_BODY",
} as const;

/**
 * Core careers (Table 2-1, Core Rulebook p37). Labels are the career names
 * themselves (proper nouns, not localized). Splat books and homebrew
 * register additional careers via CONFIG.ROGUE_TRADER.careers at init.
 */
const CAREERS = {
	"rogue-trader": "Rogue Trader",
	"arch-militant": "Arch-militant",
	"astropath-transcendent": "Astropath Transcendent",
	explorator: "Explorator",
	missionary: "Missionary",
	navigator: "Navigator",
	seneschal: "Seneschal",
	"void-master": "Void-master",
} as const;

/**
 * Psychic disciplines (bead hkc5 schema prerequisite): the disciplines a
 * psyker may learn techniques from. Core Rulebook seed is the three
 * Astropath disciplines (Core Rulebook p159); splat books (Navis Primer:
 * Voidfrost, Soul Ward, Theosophamy — and ITS) register further entries
 * at init — disciplines are content, not code, mirroring careers.
 */
const PSYCHIC_DISCIPLINES = {
	telepathy: "PSYCHIC_DISCIPLINE.TELEPATHY",
	telekinesis: "PSYCHIC_DISCIPLINE.TELEKINESIS",
	divination: "PSYCHIC_DISCIPLINE.DIVINATION",
	// Navis Primer Ch IV / Into the Storm Ch VI disciplines (bead hkc5).
	// Theosophamy (ITS p197) is the warp-sealing/banishing discipline;
	// Voidfrost (NP p92) and Soul Ward (NP p96) are the two established
	// Astropath disciplines of the Koronus Expanse.
	theosophamy: "PSYCHIC_DISCIPLINE.THEOSOPHAMY",
	voidfrost: "PSYCHIC_DISCIPLINE.VOIDFROST",
	"soul-ward": "PSYCHIC_DISCIPLINE.SOUL_WARD",
	// Weirdboy Waaagh! Discipline (NP p104) — Ork psykers.
	waaagh: "PSYCHIC_DISCIPLINE.WAAAGH",
} as const;

const SORCERY_RANKS = {
	sorcerer: "SORCERY_RANK.SORCERER",
	"master-sorcerer": "SORCERY_RANK.MASTER_SORCERER",
} as const;

/**
 * The RT registry seed: registry name -> key -> i18n label. The seeds are
 * the RT wiring; the FACTORY (createRegistries) is generic, so a sibling
 * 40k system module can build its own registry set under its own CONFIG
 * key from its own seeds (epic hr6r).
 */
const ROGUE_TRADER_SEEDS: RegistrySeeds = {
	characteristics: CHARACTERISTIC_LABELS,
	characteristicLongLabels: CHARACTERISTIC_LONG_LABELS,
	bodyLocations: BODY_LOCATIONS,
	qualities: QUALITIES,
	protectionTypes: PROTECTION_TYPES,
	battlesuitSystemCategories: BATTLESUIT_SYSTEM_CATEGORIES,
	vehicleClasses: VEHICLE_CLASSES,
	weaponFamilies: WEAPON_FAMILIES,
	vehicleFacings: VEHICLE_FACINGS,
	vehicleTraits: VEHICLE_TRAITS,
	vehicleSystems: VEHICLE_SYSTEMS,
	talentCategories: TALENT_CATEGORIES,
	talents: TALENTS,
	talentConditions: TALENT_CONDITIONS,
	afflictionProcedures: AFFLICTION_PROCEDURES,
	equipStates: EQUIP_STATES,
	careers: CAREERS,
	psychicDisciplines: PSYCHIC_DISCIPLINES,
	sorceryRanks: SORCERY_RANKS,
};

/** Registry name -> seed map (key -> i18n label). */
export type RegistrySeeds = Record<string, Record<string, string>>;

/** Registry name -> live registry. */
export type RegistrySet = Record<string, EntryRegistry>;

/**
 * Attach a set of registries under one CONFIG namespace so other packages
 * can register entries:
 *
 * ```js
 * Hooks.once("init", () => {
 *   CONFIG.ROGUE_TRADER.qualities.register("overload", "QUALITY.OVERLOAD");
 * });
 * ```
 */
export function attachRegistries(
	registries: RegistrySet,
	namespace: string,
): void {
	const global = globalThis as unknown as {
		CONFIG?: Record<string, Record<string, unknown>>;
	};
	if (!global.CONFIG) return; // pre-Foundry window (e.g. unit tests)
	const ns = (global.CONFIG[namespace] ??= {});
	Object.assign(ns, registries);
}

/**
 * Build a set of EntryRegistries from a seed table and attach them under one
 * CONFIG namespace (created on first use). Generic — the RT wiring below is
 * just `createRegistries(ROGUE_TRADER_SEEDS, "ROGUE_TRADER")`; a sibling
 * system module calls the same factory with its own seed and namespace.
 *
 * Attach is skipped when CONFIG does not exist yet (unit tests, pre-Foundry
 * imports); the system's init hook re-attaches via attachRegistriesToConfig.
 */
export function createRegistries(
	seed: RegistrySeeds,
	namespace: string,
): RegistrySet {
	const registries: RegistrySet = {};
	for (const [name, entries] of Object.entries(seed)) {
		registries[name] = new EntryRegistry(entries);
	}
	attachRegistries(registries, namespace);
	return registries;
}

/** The RT registry set, seeded above and attached to CONFIG.ROGUE_TRADER. */
const RT_REGISTRIES = createRegistries(ROGUE_TRADER_SEEDS, "ROGUE_TRADER");

export const characteristics = RT_REGISTRIES.characteristics;
export const characteristicLongLabels = RT_REGISTRIES.characteristicLongLabels;
export const bodyLocations = RT_REGISTRIES.bodyLocations;
export const qualities = RT_REGISTRIES.qualities;
export const protectionTypes = RT_REGISTRIES.protectionTypes;
export const battlesuitSystemCategories =
	RT_REGISTRIES.battlesuitSystemCategories;
export const vehicleClasses = RT_REGISTRIES.vehicleClasses;
export const weaponFamilies = RT_REGISTRIES.weaponFamilies;
export const vehicleFacings = RT_REGISTRIES.vehicleFacings;
export const vehicleTraits = RT_REGISTRIES.vehicleTraits;
export const vehicleSystems = RT_REGISTRIES.vehicleSystems;
export const talentCategories = RT_REGISTRIES.talentCategories;
export const talents = RT_REGISTRIES.talents;
export const talentConditions = RT_REGISTRIES.talentConditions;
export const afflictionProcedures = RT_REGISTRIES.afflictionProcedures;
export const equipStates = RT_REGISTRIES.equipStates;
export const careers = RT_REGISTRIES.careers;
export const psychicDisciplines = RT_REGISTRIES.psychicDisciplines;
export const sorceryRanks = RT_REGISTRIES.sorceryRanks;

/**
 * Re-attach the RT registries to CONFIG.ROGUE_TRADER during init. Module
 * import order decides when createRegistries ran; if CONFIG existed then,
 * this is a re-assign of the same live instances (extra entries registered
 * by modules survive — only the set is refreshed).
 */
export function attachRegistriesToConfig(): void {
	attachRegistries(RT_REGISTRIES, "ROGUE_TRADER");
}
