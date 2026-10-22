/**
 * Power-resolution registry (bead sa6, design bead mso6 addendum): how a
 * psychic power's SUCCESS is handled mechanically, keyed off the power's
 * `subtype` field. Weird powers = a new registered entry + data, never a
 * fork of the test pipeline (AGENT-GUIDE §11 rule of thumb).
 *
 * This registry is the ONE vocabulary source for psychic power subtypes
 * (bead ilpz): the schema `choices` (data/item/psychic-power.ts) derive
 * from the registered names, and a subtype's resolution behaviour lives on
 * the same entry — registering a subtype is a single call that feeds both
 * seams. The resolution semantics are code behaviour (Core Rulebook Ch. VI
 * technique tables: the damage-carrying subtypes roll the power's `damage`
 * expression on success — damage application is manual, mirroring the
 * weapon damage card flow), NOT book data, so the entries are seeded here
 * in code; `registerPowerSubtype` is the extension seam for splats.
 *
 * Subtypes the book defines (Core Rulebook Ch. VI): focus, bolt, barrage,
 * storm, zone. Unknown subtypes fall back to the "prose" entry — the Focus
 * Power Test still rolls and the chat card shows the prose — nothing is
 * applied automatically, never a crash.
 *
 * Pure + Foundry-free; the Foundry adapter (rules/adapter.ts) consumes it.
 */

import { Registry } from "../../ffg/domain/registry";

/** What the adapter should do after a successful Focus Power Test. */
export interface PowerResolution {
	/** The power deals its `damage` expression on success. */
	damage: boolean;
	/** Whether the power is typically sustained (informational affordance). */
	sustained: boolean;
}

/**
 * The one psychic-power-subtype vocabulary: subtype -> resolution behaviour.
 * Seeds are code behaviour (Core Rulebook Ch. VI), read live by
 * `resolvePower` and — through `psychicPowerSubtypes.choices` — by the
 * schema field, whose FUNCTION-form choices evaluate the registry at
 * validation time (bead dkh9 class), so registrations made during module
 * init — or any time before a power's save — are accepted (the registry.ts
 * in-init rule).
 *
 * The generic `Registry` (one value per key, epic kof0 phase 5) is the
 * shared primitive — no hand-rolled Map.
 */
export const psychicPowerSubtypeRegistry = new Registry<PowerResolution>({
	focus: { damage: false, sustained: false },
	bolt: { damage: true, sustained: false },
	barrage: { damage: true, sustained: false },
	storm: { damage: true, sustained: false },
	zone: { damage: true, sustained: false },
});

/**
 * Register a subtype's vocabulary + resolution in one call; repeat
 * registration replaces. This is the ONLY extension seam: the schema
 * `choices` and the resolution follow automatically.
 */
export function registerPowerSubtype(
	subtype: string,
	resolution: PowerResolution,
): void {
	psychicPowerSubtypeRegistry.register(subtype, resolution);
}

/** All registered subtype keys (registered + built-in fallback). */
export function powerResolutionKeys(): string[] {
	return psychicPowerSubtypeRegistry.keys();
}

/**
 * Resolve a subtype. The fallback "prose" entry applies to anything not
 * registered — unknown subtypes degrade to display-only, never crash.
 */
export function resolvePower(subtype: string | undefined): PowerResolution {
	const resolution = psychicPowerSubtypeRegistry.get(subtype ?? "");
	return resolution ? { ...resolution } : { ...proseResolution };
}

const proseResolution: PowerResolution = { damage: false, sustained: false };