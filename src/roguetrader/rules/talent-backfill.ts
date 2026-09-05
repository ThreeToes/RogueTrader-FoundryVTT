/**
 * Bare-legacy-talent backfill (bead oaaz): talents granted by the character
 * creator BEFORE the meh0 pack-clone fix are bare items (name + empty
 * system) — empty sheets, no compendium linkage. This module holds the pure
 * decision + patch logic; the Foundry-coupled heal lives in the talent
 * sheet (render-time backfill per AGENT-GUIDE §3 — hooks are never awaited).
 */

/** Shape of a pack talent's system fields (talents.yaml contract). */
export interface PackTalentSystem {
	category?: string;
	tier?: number;
	prereqTalent?: string;
	shortDescription?: string;
	description?: string;
	effects?: Array<Record<string, unknown>>;
}

/** Minimal view of an owned talent's system for the bare check. */
export interface OwnedTalentSystem {
	category?: string;
	tier?: number;
	description?: string;
	shortDescription?: string;
	effects?: unknown[];
}

/**
 * A talent is "bare" when it carries no pack data at all: no description
 * AND no category. Guard on both so a half-authored manual talent (category
 * set by hand) is never clobbered.
 */
export function isBareTalent(system: OwnedTalentSystem | undefined): boolean {
	if (!system) return true;
	const noDescription = !system.description && !system.shortDescription;
	const noCategory = !system.category;
	return noDescription && noCategory;
}

/**
 * The system patch to heal a bare talent from its pack counterpart. Only
 * fields the pack actually carries are included — an empty pack doc yields
 * an empty patch and the caller skips the update (nothing to heal).
 */
export function talentBackfillPatch(
	packSystem: PackTalentSystem | undefined,
): Partial<PackTalentSystem> {
	if (!packSystem) return {};
	const patch: Partial<PackTalentSystem> = {};
	if (packSystem.category) patch.category = packSystem.category;
	if (packSystem.tier !== undefined) patch.tier = packSystem.tier;
	if (packSystem.prereqTalent !== undefined) {
		patch.prereqTalent = packSystem.prereqTalent;
	}
	if (packSystem.shortDescription) {
		patch.shortDescription = packSystem.shortDescription;
	}
	if (packSystem.description) patch.description = packSystem.description;
	if (packSystem.effects && packSystem.effects.length > 0) {
		patch.effects = packSystem.effects;
	}
	return patch;
}