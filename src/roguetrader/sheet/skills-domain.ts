/**
 * Shared skill/characteristic domain helpers (bead 6l90): the ladder
 * option table, the characteristic view builder and the owned+catalog
 * skill-row merge — previously duplicated across the character sheet,
 * NPC sheet and skill sheet.
 *
 * Foundry-free by design: this module is unit-tested directly (bun test),
 * so it must not import any module that touches `foundry` at load time.
 * The data model is referenced structurally (import type only) and the
 * i18n formatter is injected by the caller.
 */

import type { CharacteristicKey } from "../data/actor/character";

// ---------------------------------------------------------------------------
// Skill ladder (Table 4-... : Known / +10 / +20)
// ---------------------------------------------------------------------------

/** The three ladder steps, shared by every ladder <select>. */
export const LADDER_OPTIONS = [
	{ value: 1, label: "SKILL.LADDER_KNOWN" },
	{ value: 2, label: "SKILL.LADDER_PLUS_10" },
	{ value: 3, label: "SKILL.LADDER_PLUS_20" },
] as const;

export type LadderOption = (typeof LADDER_OPTIONS)[number];

/**
 * Name comparison key with the t093 grant-merge semantics: trimmed +
 * case-insensitive. Catalog and owned names may differ in casing/spacing;
 * they are the same skill for every merge in the system.
 */
export function skillNameKey(name: string): string {
	return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Owned + catalog skill-row merge
// ---------------------------------------------------------------------------

/** Structural shape of an owned skill item doc (sheet or pre-shaped row). */
export interface OwnedSkillLike {
	id?: string | null;
	name?: string | null;
	system?: { ladder?: number; advanced?: boolean } | null;
}

/** Structural shape of a catalog skill entry (CatalogSkill satisfies it). */
export interface CatalogSkillLike {
	id: string;
	name: string;
	characteristic: string;
	advanced?: boolean;
	common?: boolean;
}

/** One row of a Skills-tab listing. */
export interface SkillRow {
	owned: boolean;
	id: string;
	name: string;
	advanced: boolean;
	ladder: number;
	ladderOptions: ReadonlyArray<LadderOption>;
}

/**
 * Merge owned skill items with the catalog into presentation rows,
 * alphabetically. Owned rows win; catalog entries whose name matches an
 * owned row (case-insensitive + trimmed, t093 semantics) are dropped, so
 * an owned skill whose casing differs from the catalog no longer renders
 * twice on the Skills tab.
 */
export function mergeOwnedAndCatalogRows(
	owned: OwnedSkillLike[],
	catalog: CatalogSkillLike[],
): SkillRow[] {
	const rows: SkillRow[] = [];
	const ownedKeys = new Set<string>();
	for (const item of owned) {
		const name = item.name ?? "";
		ownedKeys.add(skillNameKey(name));
		rows.push({
			owned: true,
			id: item.id ?? "",
			name,
			advanced: item.system?.advanced === true,
			ladder: item.system?.ladder ?? 0,
			ladderOptions: LADDER_OPTIONS,
		});
	}
	for (const entry of catalog) {
		if (ownedKeys.has(skillNameKey(entry.name))) continue;
		rows.push({
			owned: false,
			id: entry.id,
			name: entry.name,
			advanced: entry.advanced === true,
			ladder: 0,
			ladderOptions: LADDER_OPTIONS,
		});
	}
	rows.sort((a, b) => a.name.localeCompare(b.name));
	return rows;
}

// ---------------------------------------------------------------------------
// Characteristic views
// ---------------------------------------------------------------------------

/** Short characteristic forms for compact tables (data model order). */
export const CHAR_SHORTS: Readonly<Record<CharacteristicKey, string>> = {
	ws: "WS",
	bs: "BS",
	s: "S",
	t: "T",
	ag: "Ag",
	int: "Int",
	per: "Per",
	wp: "WP",
	fel: "Fel",
};

/** Max unnatural multiplier shown as pips. */
export const MAX_UNNATURAL_STEPS = 5;

/**
 * Structural subset of the Character data model the view builder needs
 * (Character satisfies it; a plain fixture satisfies it in tests).
 */
export interface CharacteristicSystemLike {
	characteristics: Record<string, { value: number; unnatural: number }>;
	characteristicBonus(key: string): number;
	effectiveCharacteristicBonus(key: string): number;
}

export interface CharacteristicView {
	key: string;
	label: string;
	value: number;
	bonus: number;
	effectiveBonus: number;
	unnatural: number;
	bonusTooltip: string;
	unnaturalTooltip: string;
	pips: Array<{ value: number; lit: boolean }>;
}

/**
 * Explorer-style characteristic views: value, natural/effective bonus,
 * tooltips and unnatural pips. `format` is an i18n.format-like injected by
 * the caller (game.i18n.format in the sheets) so the builder stays pure.
 */
export function buildCharacteristicViews(
	system: CharacteristicSystemLike,
	format: (key: string, vars?: Record<string, unknown>) => string,
): CharacteristicView[] {
	return Object.entries(system.characteristics).map(
		([key, data]): CharacteristicView => {
			const bonus = system.characteristicBonus(key);
			const effectiveBonus = system.effectiveCharacteristicBonus(key);
			return {
				key,
				label: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: data.value,
				unnatural: data.unnatural,
				bonus,
				effectiveBonus,
				bonusTooltip: format("CHARACTER.BONUS_TOOLTIP", {
					bonus: data.unnatural > 1 ? effectiveBonus : bonus,
				}),
				unnaturalTooltip: format("CHARACTER.UNNATURAL_TOOLTIP", {
					mult: data.unnatural,
				}),
				pips: Array.from({ length: MAX_UNNATURAL_STEPS }, (_, i) => {
					const mult = i + 2; // pip 1 = x2
					return { value: mult, lit: data.unnatural >= mult };
				}),
			};
		},
	);
}