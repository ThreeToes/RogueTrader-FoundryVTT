/**
 * Combat tracker resource default (bead nc3q, epic wjpi).
 *
 * Two guards the bead asks for:
 *
 *  1. A config-object guard test pinning the DEFAULT resource wiring: the
 *     re-registered `core.combatTrackerConfig` default points at current
 *     Wounds (`wounds.value`) and touches nothing else — the standard
 *     CombatTrackerConfig combobox must remain the live knob (schema type and
 *     onChange copied verbatim; only the default changed, so a stored setting
 *     still overrides).
 *
 *  2. A unit test of the value resolution against a faked combatant/actor,
 *     mirroring core's Combatant#updateResource
 *     (foundry.mjs:59927-59928): with the default path `wounds.value`, a
 *     character-system actor yields the wound value — including a 0, which
 *     `?? null` passes straight through — and an actor whose system has no
 *     wound track (starship, vehicle) yields null so the chip is hidden.
 */

import { afterAll, describe, expect, test } from "bun:test";

// --- Foundry stubs (before importing the module under test) ----------------

type HookFn = (...args: never[]) => unknown;

const readyHooks: Array<HookFn> = [];

const globals = globalThis as Record<string, unknown>;
const saved = {
	Hooks: globals.Hooks,
	game: globals.game,
};

/** A faked registration entry, matching core's shape for the tracker setting. */
interface Registration {
	default: unknown;
	type?: unknown;
	onChange?: unknown;
	[key: string]: unknown;
}

const CORE_ENTRY: Registration = {
	default: {
		resource: "",
		skipDefeated: false,
		turnMarker: { enabled: true, animation: "spin" },
	},
	type: { resource: "the-schema-field" },
	onChange: () => undefined,
};

const registrations: Map<string, Registration> = new Map();

globals.Hooks = {
	once: (name: string, fn: HookFn) => {
		if (name === "ready") readyHooks.push(fn);
	},
};

globals.game = {
	settings: {
		register: (ns: string, key: string, data: object) => {
			registrations.set(`${ns}.${key}`, data as Registration);
		},
		settings: new Map([["core.combatTrackerConfig", CORE_ENTRY]]),
	},
};

const { registerCombatTrackerDefault, TRACKER_RESOURCE } = await import(
	"./combat-tracker"
);

// The real Character schema, for the leaf-path guard below.
await import("../../test-helpers/foundry-schema-stub");
const { Character } = await import("../data/actor/character");

registerCombatTrackerDefault();
for (const fn of readyHooks) fn();

// --- Tests -----------------------------------------------------------------

describe("combat tracker resource default (bead nc3q)", () => {
	test("re-registers core.combatTrackerConfig at ready", () => {
		expect(registrations.get("core.combatTrackerConfig")).toBeDefined();
	});

	test("defaults the resource to current Wounds", () => {
		const entry = registrations.get(
			"core.combatTrackerConfig",
		) as Registration;
		const settings = entry.default as { resource?: unknown };
		expect(settings.resource).toBe("wounds.value");
		expect(TRACKER_RESOURCE).toBe("wounds.value");
	});

	test("keeps every other default (skipDefeated, turnMarker) untouched", () => {
		const entry = registrations.get(
			"core.combatTrackerConfig",
		) as Registration;
		const settings = entry.default as {
			skipDefeated?: boolean;
			turnMarker?: Record<string, unknown>;
		};
		expect(settings.skipDefeated).toBe(false);
		expect(settings.turnMarker).toEqual({ enabled: true, animation: "spin" });
	});

	test("leaves the GM's combobox wired (schema type + onChange copied)", () => {
		// The CombatTrackerConfig combobox works because it reads and writes
		// the same setting through the SAME schema field; only the default is
		// overridden, so a stored value (the GM's choice) still wins.
		const entry = registrations.get(
			"core.combatTrackerConfig",
		) as Registration;
		expect(entry.type).toBe(CORE_ENTRY.type);
		expect(entry.onChange).toBe(CORE_ENTRY.onChange);
	});

	test("degrades silently when core has not registered the setting", () => {
		// Content-optional: a missing registration leaves the map untouched.
		// Fire a fresh module load against a game without the setting.
		const registrationsBefore = registrations.size;
		globals.game = {
			settings: {
				register: () => undefined,
				settings: new Map(),
			},
		};
		// Re-import is impossible in bun's module cache; emulate the guard via
		// a second hook registration + fire — a no-op registration must not
		// throw. (The composition-root wiring re-runs registerCombatTrackerDefault.)
		readyHooks.length = 0;
		registerCombatTrackerDefault();
		for (const fn of readyHooks) fn();
		expect(registrations.size).toBe(registrationsBefore);
	});
});

// --- Value-resolution semantics (core mirror, foundry.mjs:59927-59928) -----

describe("combatant chip value resolution with the Wounds default", () => {
	/**
	 * Core's Combatant#updateResource, verbatim semantics:
	 * `getResource(actor.system, settings.resource)` returns
	 * `getProperty(actor.system, resource) ?? null` (foundry.mjs:59928); the
	 * chip renders whatever comes back (tracker context passes it unchanged,
	 * foundry.mjs:140172). The tiny get below mirrors getProperty's path
	 * walk for dot-paths only — the only form the tracker's combobox emits.
	 */
	function getResource(system: unknown, path: string): unknown {
		let value: unknown = system;
		for (const key of path.split(".")) {
			if (value === null || typeof value !== "object") return undefined;
			value = (value as Record<string, unknown>)[key];
		}
		return value;
	}

	function chipValue(actorSystem: unknown, path: string): unknown {
		return getResource(actorSystem, path) ?? null;
	}

	test("a character-actor's current Wounds render as the chip value", () => {
		const system = { wounds: { value: 12, max: 14 } };
		expect(chipValue(system, "wounds.value")).toBe(12);
	});

	test("wounds at 0 still render (0 passes through `?? null`)", () => {
		const system = { wounds: { value: 0, max: 14 } };
		expect(chipValue(system, "wounds.value")).toBe(0);
	});

	test("an actor without a wound track resolves null (chip hidden)", () => {
		expect(chipValue({}, "wounds.value")).toBeNull();
		// Ship/vehicle systems never carry wounds.value.
		expect(chipValue({ hull: { value: 10, max: 10 } }, "wounds.value")).toBe(
			null,
		);
	});
});

// --- The default path exists on the REAL Character schema -------------------

describe("wounds.value is a real Character schema leaf", () => {
	test("the default resource path resolves against the data model schema", () => {
		const schema = Character.defineSchema() as Record<
			string,
			{ fields?: Record<string, unknown> }
		>;
		const wounds = schema.wounds?.fields;
		expect(wounds?.value).toBeDefined();
	});
});

// --- Restore ----------------------------------------------------------------

afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});