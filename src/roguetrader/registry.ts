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
export class EntryRegistry {
	readonly #entries: Map<string, string>;

	constructor(initial: Record<string, string> = {}) {
		this.#entries = new Map(Object.entries(initial));
	}

	/** Register an entry. Overwrites any existing entry with the same key. */
	register(key: string, labelKey: string): this {
		this.#entries.set(key, labelKey);
		return this;
	}

	has(key: string): boolean {
		return this.#entries.has(key);
	}

	get(key: string): string | undefined {
		return this.#entries.get(key);
	}

	keys(): string[] {
		return [...this.#entries.keys()];
	}

	entries(): Array<[string, string]> {
		return [...this.#entries.entries()];
	}

	/** Choices shape expected by `StringField#choices` and `selectOptions`. */
	get choices(): Record<string, string> {
		return Object.fromEntries(this.#entries);
	}
}

const BODY_LOCATIONS = {
	head: "BODY_LOCATION.HEAD",
	body: "BODY_LOCATION.BODY",
	"left-arm": "BODY_LOCATION.LEFT_ARM",
	"right-arm": "BODY_LOCATION.RIGHT_ARM",
	"left-leg": "BODY_LOCATION.LEFT_LEG",
	"right-leg": "BODY_LOCATION.RIGHT_LEG",
} as const;

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
	corrosive: "QUALITY.CORROSIVE",
	defensive: "QUALITY.DEFENSIVE",
	flexible: "QUALITY.FLEXIBLE",
	flame: "QUALITY.FLAME",
	inaccurate: "QUALITY.INACCURATE",
	overheats: "QUALITY.OVERHEATS",
	powerField: "QUALITY.POWER_FIELD",
	powerful: "QUALITY.POWERFUL",
	primitive: "QUALITY.PRIMITIVE",
	recharge: "QUALITY.RECHARGE",
	reliable: "QUALITY.RELIABLE",
	scatter: "QUALITY.SCATTER",
	shocking: "QUALITY.SHOCKING",
	smoke: "QUALITY.SMOKE",
	snare: "QUALITY.SNARE",
	storm: "QUALITY.STORM",
	tearing: "QUALITY.TEARING",
	toxic: "QUALITY.TOXIC",
	unbalanced: "QUALITY.UNBALANCED",
	unreliable: "QUALITY.UNRELIABLE",
	unwieldy: "QUALITY.UNWIELDY",
	volatile: "QUALITY.VOLATILE",
} as const;

const PROTECTION_TYPES = {
	primitive: "PROTECTION_TYPE.PRIMITIVE",
	"non-primitive": "PROTECTION_TYPE.NON_PRIMITIVE",
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

export const bodyLocations = new EntryRegistry(BODY_LOCATIONS);
export const qualities = new EntryRegistry(QUALITIES);
export const protectionTypes = new EntryRegistry(PROTECTION_TYPES);
export const vehicleClasses = new EntryRegistry(VEHICLE_CLASSES);
export const vehicleFacings = new EntryRegistry(VEHICLE_FACINGS);
export const vehicleTraits = new EntryRegistry(VEHICLE_TRAITS);
export const vehicleSystems = new EntryRegistry(VEHICLE_SYSTEMS);
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
} as const;

export const talentCategories = new EntryRegistry(TALENT_CATEGORIES);
export const talents = new EntryRegistry(TALENTS);
export const talentConditions = new EntryRegistry(TALENT_CONDITIONS);
export const equipStates = new EntryRegistry(EQUIP_STATES);

type RogueTraderRegistries = {
	bodyLocations: EntryRegistry;
	qualities: EntryRegistry;
	protectionTypes: EntryRegistry;
	vehicleClasses: EntryRegistry;
	vehicleFacings: EntryRegistry;
	vehicleTraits: EntryRegistry;
	vehicleSystems: EntryRegistry;
	talentCategories: EntryRegistry;
	talents: EntryRegistry;
	equipStates: EntryRegistry;
};

/**
 * Expose registries through CONFIG so other packages can register entries:
 *
 * ```js
 * Hooks.once("init", () => {
 *   CONFIG.ROGUE_TRADER.qualities.register("overload", "QUALITY.OVERLOAD");
 * });
 * ```
 */
export function attachRegistriesToConfig() {
	const config = CONFIG as unknown as {
		ROGUE_TRADER?: Partial<RogueTraderRegistries>;
	};
	const rt = (config.ROGUE_TRADER ??= {});
	rt.bodyLocations = bodyLocations;
	rt.qualities = qualities;
	rt.protectionTypes = protectionTypes;
	rt.vehicleClasses = vehicleClasses;
	rt.vehicleFacings = vehicleFacings;
	rt.vehicleTraits = vehicleTraits;
	rt.vehicleSystems = vehicleSystems;
	rt.talentCategories = talentCategories;
	rt.talents = talents;
	rt.equipStates = equipStates;
}
