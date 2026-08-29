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
	flame: "QUALITY.FLAME",
	overheats: "QUALITY.OVERHEATS",
	powerful: "QUALITY.POWERFUL",
	reliable: "QUALITY.RELIABLE",
	scatter: "QUALITY.SCATTER",
	shocking: "QUALITY.SHOCKING",
	storm: "QUALITY.STORM",
	toxic: "QUALITY.TOXIC",
	unreliable: "QUALITY.UNRELIABLE",
	volatile: "QUALITY.VOLATILE",
} as const;

const PROTECTION_TYPES = {
	primitive: "PROTECTION_TYPE.PRIMITIVE",
	"non-primitive": "PROTECTION_TYPE.NON_PRIMITIVE",
} as const;

export const bodyLocations = new EntryRegistry(BODY_LOCATIONS);
export const qualities = new EntryRegistry(QUALITIES);
export const protectionTypes = new EntryRegistry(PROTECTION_TYPES);

type RogueTraderRegistries = {
	bodyLocations: EntryRegistry;
	qualities: EntryRegistry;
	protectionTypes: EntryRegistry;
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
}
