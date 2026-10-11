/**
 * Starting Kit lookup (owner rework 2026, epic zlwc child mxhj): the kit
 * content (key/slots/quote) lives in the `gearsets` source of the
 * `character-options` pack, one Item per career. This module keeps the shared
 * types, the runtime pool (warmed at ready like the heirloom/warrant pools),
 * and the by-career lookup — the creator's kit step and grant resolve
 * synchronously against it.
 *
 * Pure rules module (the heirlooms.ts precedent): Foundry coupling stays in
 * the warmer and the creator.
 */

import type { GearsetEntry, GearsetSlot } from "../data/item/gearset";

export type { GearsetSlot } from "../data/item/gearset";

/** Runtime kit pool (warmed from the character-options pack at ready). */
let kitPool: GearsetEntry[] = [];

/** Replace the runtime kit pool (pack loader / tests). */
export function setGearsetEntries(entries: GearsetEntry[]): void {
	kitPool = entries;
}

/** The current runtime kit pool. */
export function getGearsetEntries(): GearsetEntry[] {
	return kitPool;
}

/** The kit authored for a career key, or null (no kit in the pack). */
export function gearsetFor(careerKey: string): GearsetEntry | null {
	return kitPool.find((entry) => entry.key === careerKey) ?? null;
}

/** Slots that offer a real pick-one choice (the book's "or" groups). */
export function kitChoiceSlots(kit: GearsetEntry): GearsetSlot[] {
	return (kit.slots ?? []).filter((slot) => (slot?.options?.length ?? 0) > 1);
}

/**
 * Are all choice slots resolved? (the creator's Next/Finish gate). A kit
 * without any choice slot is always complete — its fixed rows grant as-is.
 */
export function kitChoicesComplete(
	kit: GearsetEntry | null,
	picks: Record<number, number>,
): boolean {
	if (!kit) return true;
	return (kit.slots ?? []).every(
		(slot, index) =>
			(slot?.options?.length ?? 0) <= 1 ||
			(picks[index] !== undefined && picks[index] >= 0),
	);
}
