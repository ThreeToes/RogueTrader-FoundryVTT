/**
 * Owned-skill lookup (bead bw9x) — the single home for "find the actor's
 * trained skill item by its ENGLISH pack name, else the untrained
 * characteristic fallback".
 *
 * This used to be written twice with subtly different shapes:
 * evasion.ts (the reaction's Parry/Dodge name match with a Parry→ws /
 * Dodge→ag fallback) and action.ts (dodgeSkillRoute, fallback hardcoded to
 * `ag`). Both sites now read this rule, and the space-combat epic (necp,
 * bead z697 — Hail the Enemy) adds a third user of the same pattern.
 *
 * Pure module: no Foundry globals, no ports — the name match is against the
 * pack's printed English skill names, and the fallback characteristic table
 * is the same data both call sites already owned. Call sites are one-liners:
 * `findOwnedSkillItem(actor, "Dodge")` plus
 * `UNTRAINED_SKILL_CHARACTERISTIC["Dodge"]` when the item is absent.
 */

/** The minimal item shape the lookup needs (structural, Foundry-free). */
export type SkillItemLike = {
	id?: string | null;
	name?: string | null;
	type?: string;
};

/** Anything with an iterable items collection (a Foundry Actor, or a test stub). */
export type SkillItemSource = {
	items: Iterable<SkillItemLike>;
};

/**
 * The actor's owned/trained skill item whose ENGLISH name matches — the
 * name-match is against pack data ("Dodge", "Parry"), exactly as both
 * former copies matched.
 */
export function findOwnedSkillItem(
	actor: SkillItemSource,
	name: string,
): SkillItemLike | undefined {
	for (const item of actor.items) {
		if (item.type === "skill" && item.name === name) return item;
	}
	return undefined;
}

/**
 * Untrained-fallback characteristic per skill name (Core Rulebook p74
 * untrained-skill model): Parry is governed by Weapon Skill, Dodge by
 * Agility — the evasion reaction's rule, now shared. A name with no fallback
 * here means the caller must decide what untrained means for it (advanced
 * skills cannot be attempted untrained).
 */
export const UNTRAINED_SKILL_CHARACTERISTIC: Readonly<Record<string, string>> = {
	Parry: "ws",
	Dodge: "ag",
};

/** The untrained-fallback characteristic for a skill name, if the table has one. */
export function untrainedCharacteristicFor(name: string): string | undefined {
	return UNTRAINED_SKILL_CHARACTERISTIC[name];
}