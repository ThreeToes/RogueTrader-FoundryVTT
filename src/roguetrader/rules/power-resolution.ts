/**
 * Power-resolution registry (bead sa6, design bead mso6 addendum): how a
 * psychic power's SUCCESS is handled mechanically, keyed off the power's
 * `subtype` field. Weird powers = a new registered entry + data, never a
 * fork of the test pipeline (AGENT-GUIDE §11 rule of thumb).
 *
 * Subtypes the book defines (rt_core Ch. VI): focus, bolt, barrage, storm,
 * zone. The "prose" entry is the fallback for powers whose effect has no
 * mechanical representation yet: the Focus Power Test still rolls and the
 * chat card shows the prose — nothing is applied automatically.
 *
 * Pure + Foundry-free; the Foundry adapter (rules/adapter.ts) consumes it.
 */

/** What the adapter should do after a successful Focus Power Test. */
export interface PowerResolution {
	/** The power deals its `damage` expression on success. */
	damage: boolean;
	/** Whether the power is typically sustained (informational affordance). */
	sustained: boolean;
}

export type PowerResolutionHandler = () => PowerResolution;

const registry = new Map<string, PowerResolutionHandler>();

/** Register a subtype's resolution; repeat registration replaces. */
export function registerPowerResolution(
	subtype: string,
	handler: PowerResolutionHandler,
): void {
	registry.set(subtype, handler);
}

/** All registered subtype keys (registered + built-in fallback). */
export function powerResolutionKeys(): string[] {
	return [...registry.keys()];
}

/**
 * Resolve a subtype. The fallback "prose" entry applies to anything not
 * registered — unknown subtypes degrade to display-only, never crash.
 */
export function resolvePower(subtype: string | undefined): PowerResolution {
	const handler = registry.get(subtype ?? "") ?? proseResolution;
	return handler();
}

function proseResolution(): PowerResolution {
	return { damage: false, sustained: false };
}

// Built-in subtypes (rt_core Ch. VI technique tables; the damage-carrying
// subtypes roll the power's `damage` expression on success — damage
// application to targets is manual for now, mirroring the weapon damage
// card flow).
registerPowerResolution("focus", () => ({ damage: false, sustained: false }));
registerPowerResolution("bolt", () => ({ damage: true, sustained: false }));
registerPowerResolution("barrage", () => ({ damage: true, sustained: false }));
registerPowerResolution("storm", () => ({ damage: true, sustained: false }));
registerPowerResolution("zone", () => ({ damage: true, sustained: false }));