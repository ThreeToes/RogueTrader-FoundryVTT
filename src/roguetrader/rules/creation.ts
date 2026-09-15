/**
 * Pure character-creation logic (bead ay0, Core Rulebook Chapter I stages 1-2).
 *
 * Stage 1 characteristics (p14): roll 2d10+25 per characteristic (one total
 * re-roll allowed) OR point-buy: 25 base, +100 points total, max +20 to any
 * one characteristic. Stage 2 applies Origin Path mechanics (see origins.ts).
 * Everything here is pure data-in/data-out; dice and documents belong to the
 * creator application.
 */

import { type ResolvedOrigin } from "../origins";

export type { ResolvedOrigin };

/**
 * Mirrors data/actor/character.ts CHARACTERISTIC_KEYS without importing the
 * DataModel (which requires the Foundry global at module load).
 */
const CHARACTERISTIC_KEYS = [
	"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
] as const;

type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

/** Base characteristic value before allocation (both methods, p14). */
export const CHARACTERISTIC_BASE = 25;
/** Point-buy budget and per-characteristic cap (p14 "Allocating Points"). */
export const POINT_BUY_BUDGET = 100;
export const POINT_BUY_MAX = 20;

export interface PointBuyValidation {
	total: number;
	remaining: number;
	valid: boolean;
	overCap: CharacteristicKey[];
}

/** Validate a point-buy allocation against the p14 budget/cap rules. */
export function validatePointBuy(
	allocated: Partial<Record<CharacteristicKey, number>>,
): PointBuyValidation {
	const total = Object.values(allocated).reduce<number>(
		(sum, value) => sum + (value ?? 0),
		0,
	);
	const overCap = CHARACTERISTIC_KEYS.filter(
		(key) => (allocated[key] ?? 0) > POINT_BUY_MAX,
	);
	return {
		total,
		remaining: POINT_BUY_BUDGET - total,
		valid: total <= POINT_BUY_BUDGET && overCap.length === 0,
		overCap,
	};
}

/**
 * Whether the creator's forward button can advance (fix 2026-09-14). Every
 * step before the last advances freely; the final Create action needs the full
 * validation. The shared `rt/creator-nav` partial disables the button when
 * `forwardDisabled` is truthy, so the character creator passing raw
 * `canCreate` (which is `step === 3 && ...`) disabled Next on every earlier
 * step. Pure + testable.
 */
export function creatorCanAdvance(step: number, canCreate: boolean): boolean {
	return step !== CREATOR_LAST_STEP || canCreate;
}

/**
 * The creator's final step index (bead ghmn added a Species step at 0, so the
 * wizard is now 0 species, 1 characteristics, 2 origin, 3 career/review,
 * 4 equipment). Keep the creator's step bounds and this constant in sync.
 */
export const CREATOR_LAST_STEP = 4;

/**
 * Final characteristics: base (or rolled values) plus origin deltas,
 * clamped to the schema range 0-100.
 */
export function finalCharacteristics(
	base: Record<CharacteristicKey, number>,
	deltas: Partial<Record<CharacteristicKey, number>>,
): Record<CharacteristicKey, number> {
	const result = {} as Record<CharacteristicKey, number>;
	for (const key of CHARACTERISTIC_KEYS) {
		result[key] = Math.min(100, Math.max(0, (base[key] ?? 0) + (deltas[key] ?? 0)));
	}
	return result;
}

/**
 * Starting wounds per the book's Home World sections (p17-24): double the
 * starting Toughness Bonus, add the world's wound dice total, plus flat
 * bonuses (Motivation: Endurance +1).
 */
export function woundsFromOrigin(
	toughnessBonus: number,
	woundsDiceTotals: number[],
	woundBonus: number,
): number {
	return toughnessBonus * 2 + woundsDiceTotals.reduce((a, b) => a + b, 0) + woundBonus;
}

/**
 * Species options derived from the CAREERS compendium (bead ghmn).
 *
 * Xenos have no separate compendium record: the book prints a xeno's
 * characteristics, wounds and Fate on its career entry, and the pack stores
 * that as `Career.system.species` (bead koau). So the creator's species list IS
 * the set of distinct species blocks across the career pack, plus the human
 * default (a career with no species block). Nothing is authored here — adding
 * a xeno career with a species block adds its species automatically.
 */
export interface SpeciesSource {
	key?: string;
	label?: string;
	baseCharacteristics?: Record<string, number>;
	startingFate?: number;
	fateFormula?: string;
	woundsFormula?: string;
}

export interface SpeciesOption {
	/** "" = human, i.e. the absence of a species block. */
	key: string;
	/** Pack-supplied label; blank for human (the template localizes a key). */
	label: string;
	/** Per-characteristic 2d10 base, human default where the pack omits one. */
	base: Record<CharacteristicKey, number>;
	/** Fixed starting Fate, when the book prints a number. */
	startingFate: number;
	/** Verbatim printed Fate roll, when Fate is not a fixed number. */
	fateFormula: string;
	/** Verbatim printed Wounds formula. */
	woundsFormula: string;
}

/** The human species is the ABSENCE of a species block, never a pack record. */
export const HUMAN_SPECIES_KEY = "";

function humanBaseMap(humanBase: number): Record<CharacteristicKey, number> {
	const base = {} as Record<CharacteristicKey, number>;
	for (const key of CHARACTERISTIC_KEYS) base[key] = humanBase;
	return base;
}

/**
 * Build the species list from career species blocks. Human is always first;
 * duplicates collapse (two Dark Eldar careers share one species) and a blank
 * key is ignored. A characteristic the pack omits keeps the human base —
 * the pack stores the book's "2d10+" adds, so an absent key means "unchanged".
 */
export function speciesOptions(
	sources: Array<SpeciesSource | undefined> | undefined,
	humanBase = CHARACTERISTIC_BASE,
): SpeciesOption[] {
	const human: SpeciesOption = {
		key: HUMAN_SPECIES_KEY,
		label: "",
		base: humanBaseMap(humanBase),
		startingFate: 0,
		fateFormula: "",
		woundsFormula: "",
	};
	const byKey = new Map<string, SpeciesOption>([[human.key, human]]);
	for (const source of sources ?? []) {
		const key = (source?.key ?? "").trim();
		if (!key || byKey.has(key)) continue;
		const base = humanBaseMap(humanBase);
		for (const [characteristic, value] of Object.entries(
			source?.baseCharacteristics ?? {},
		)) {
			if (characteristic in base && Number.isFinite(value)) {
				base[characteristic as CharacteristicKey] = value;
			}
		}
		byKey.set(key, {
			key,
			label: source?.label ?? "",
			base,
			startingFate: source?.startingFate ?? 0,
			fateFormula: source?.fateFormula ?? "",
			woundsFormula: source?.woundsFormula ?? "",
		});
	}
	return [...byKey.values()];
}

/**
 * A career's species binding: blank = human.
 *
 * Accepts BOTH shapes on purpose: the creator builds view models carrying a
 * top-level `species`, while a raw compendium doc carries it at
 * `system.species`. Reading only one of them silently classified every pack
 * career as human (caught by the pack-driven test in careers.test.ts).
 */
export function speciesKeyOf(career: {
	species?: { key?: string };
	system?: { species?: { key?: string } };
}): string {
	return (career?.species?.key ?? career?.system?.species?.key ?? "").trim();
}

/**
 * Starting careers legal for a species: an exact species match against the
 * career's own species block. Alternate/elite ranks carry their own verbatim
 * gates and are not creation-time choices (every one needs rank 1+ and 5,000+
 * XP), so they are filtered out by the caller before this runs.
 */
export function careersForSpecies<
	T extends {
		species?: { key?: string };
		system?: { species?: { key?: string } };
	},
>(careers: T[] | undefined, speciesKey: string): T[] {
	const want = (speciesKey ?? "").trim();
	return (careers ?? []).filter((career) => speciesKeyOf(career) === want);
}

export interface CatalogSkill {
	name: string;
	characteristic: string;
}

export interface OriginSkillGrant {
	name: string;
	type: "skill";
	system: { characteristic: string; ladder: number };
}

/**
 * Match a resolved origin's skills/options against the skill catalog
 * (exact name first, then specialization prefix, e.g. "Forbidden Lore
 * (choose one)" needs explicit choice so it stays unmatched). Unmatched
 * entries are returned for manual grant — never silently dropped.
 */
export function matchOriginSkills(
	resolved: ResolvedOrigin,
	catalog: CatalogSkill[],
): { grants: OriginSkillGrant[]; unmatched: string[] } {
	const grants: OriginSkillGrant[] = [];
	const unmatched: string[] = [];
	const candidates = [...resolved.skills, ...resolved.options];
	const escapeRegExp = (text: string) =>
		text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	for (const candidate of candidates) {
		const exact = catalog.find(
			(entry) => entry.name.toLowerCase() === candidate.toLowerCase(),
		);
		if (exact) {
			grants.push({
				name: exact.name,
				type: "skill",
				system: { characteristic: exact.characteristic, ladder: 1 },
			});
			continue;
		}
		// Specialization form "Base (Spec)": clone the base skill's
		// characteristic (unique plain entry, or derived from known
		// specializations of the same base, e.g. "Speak Language (High
		// Gothic)" for "Speak Language (Ship Dialect)").
		const paren = /^(.+?)\s*\(/.exec(candidate);
		const base = paren?.[1]?.trim();
		if (base) {
			const baseMatches = catalog.filter(
				(entry) => entry.name.toLowerCase() === base.toLowerCase(),
			);
			const chosen = baseMatches.length === 1 ? baseMatches[0] : undefined;
			const specMatches = catalog.filter((entry) =>
				new RegExp(`^${escapeRegExp(base)}\\s*\\(`, "i").test(entry.name),
			);
			const specCharacteristics = new Set(
				specMatches.map((entry) => entry.characteristic),
			);
			const derived =
				chosen ??
				(specMatches.length > 0 && specCharacteristics.size === 1
					? { characteristic: specMatches[0]!.characteristic }
					: undefined);
			if (derived) {
				grants.push({
					name: candidate,
					type: "skill",
					system: { characteristic: derived.characteristic, ladder: 1 },
				});
				continue;
			}
		}
		unmatched.push(candidate);
	}
	return { grants, unmatched };
}

/** "Choose one" placeholders that always need a player/GM pick. */
export function isUnresolvedChoice(candidate: string): boolean {
	return /\(choose one\)/i.test(candidate);
}