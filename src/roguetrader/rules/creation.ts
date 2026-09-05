/**
 * Pure character-creation logic (bead ay0, rt_core Chapter I stages 1-2).
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