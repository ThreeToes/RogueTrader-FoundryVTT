/**
 * Fear machinery (bead jpbm, Core Rulebook Ch X "Fear and Damnation"
 * p294-296). Pure rules module: the adapter-side roll kind (roll-system.ts)
 * consumes these functions; Foundry dice and chat stay out of here.
 *
 * Book rules (verbatim cites):
 * - "a Fear Test; this is a Willpower Test, modified by how frightening the
 *   thing is" (p295). Table 10-3 Fear Test Difficulties (p295): Fear (1) +0,
 *   Fear (2) (−10), Fear (3) (−20), Fear (4) (−30).
 * - "If a character fails a Fear Test in a combat situation, he must
 *   immediately roll on Table 10-4: The Shock Table, adding +10 to the
 *   result for each Degree of Failure" (p295).
 * - Non-combat failure: "becomes unnerved and suffers a −10 penalty to any
 *   Skill or Test that requires concentration"; failed by 30 or more also
 *   gains +1d5 Insanity Points (p296).
 * - "Snap out of it": Willpower Test at the beginning of his next Turn
 *   (p296).
 */
import type { Modifier } from "../../rules-engine/src/modifier";

/** Table 10-3 ladder: the test modifier for a given Fear rating. */
export function fearTestModifier(rating: number): number {
	if (!Number.isInteger(rating) || rating < 1) {
		// Loud data: an unparseable Fear (X) must never silently become +0.
		throw new Error(`rogue-trader: invalid Fear rating "${rating}"`);
	}
	const penalty = (rating - 1) * 10;
	return penalty === 0 ? 0 : -penalty;
}

/**
 * Parse a Fear rating from a trait item's name/benefit pair. Handles the
 * statblock forms the book prints: name "Fear (2)" with an optional benefit
 * parameter ("2"); bare benefit falls back for renamed entries.
 */
export function parseFearRating(
	name: string | undefined,
	benefit: string | undefined,
): number | null {
	const candidates = [benefit, name];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const match = /(?:^|\b)(?:fear\s*)?\(?\s*(\d+)\s*\)?/i.exec(
			candidate.trim(),
		);
		const rating = match ? Number(match[1]) : NaN;
		if (Number.isInteger(rating) && rating >= 1) return rating;
	}
	return null;
}

/**
 * The strongest Fear (X) carried by `actor`'s trait items (traits are innate
 * and always live, bead yb6/zyv1). Null = this actor causes no Fear.
 * Unparseable Fear traits are skipped loudly (console.warn), never dropped
 * silently.
 */
export function resolveFearRating(actor: unknown): number | null {
	const items = (actor as { items?: Array<{
		name?: string;
		type?: string;
		system?: { benefit?: string };
	}> }).items ?? [];
	let best: number | null = null;
	for (const item of items) {
		if (item.type !== "trait") continue;
		if (!/^fear\b/i.test(item.name ?? "")) continue;
		const rating = parseFearRating(item.name, item.system?.benefit);
		if (rating === null) {
			console.warn(
				`rogue-trader: unparseable Fear trait "${item.name}" (bead jpbm)`,
			);
			continue;
		}
		best = Math.max(best ?? 0, rating);
	}
	return best;
}

/** Mirror of the kernel's degrees-of-success rule, on the failure side. */
export function degreesOfFailure(target: number, roll: number): number {
	return Math.floor(Math.max(0, roll - target) / 10) + 1;
}

/**
 * Table 10-4: The Shock Table (Core Rulebook p294, VERBATIM book text kept
 * as i18n keys; see lang/*.json). `after` is inclusive lower bound; roll
 * + 10 per degree of failure lands in the first bucket with after <= total.
 */
export interface ShockRow {
	after: number;
	/** i18n key under FEAR.SHOCK_* */
	textKey: string;
}

export const SHOCK_TABLE: ShockRow[] = [
	{ after: 1, textKey: "FEAR.SHOCK_01_20" },
	{ after: 21, textKey: "FEAR.SHOCK_21_40" },
	{ after: 41, textKey: "FEAR.SHOCK_41_60" },
	{ after: 61, textKey: "FEAR.SHOCK_61_80" },
	{ after: 81, textKey: "FEAR.SHOCK_81_100" },
	{ after: 101, textKey: "FEAR.SHOCK_101_120" },
	{ after: 121, textKey: "FEAR.SHOCK_121_130" },
	{ after: 131, textKey: "FEAR.SHOCK_131_140" },
	{ after: 141, textKey: "FEAR.SHOCK_141_160" },
	{ after: 161, textKey: "FEAR.SHOCK_161_170" },
	{ after: 171, textKey: "FEAR.SHOCK_171_PLUS" },
];

/** Shock Table lookup (data in / row out; falls back to the top bucket). */
export function shockOutcome(shockRoll: number): ShockRow {
	const total = Math.max(0, Math.floor(shockRoll));
	// A bucket's upper bound is the NEXT row's `after` − 1; the last bucket
	// (171+) is open-ended.
	for (let i = 0; i < SHOCK_TABLE.length; i++) {
		const row = SHOCK_TABLE[i];
		const next = SHOCK_TABLE[i + 1];
		const upper = next ? next.after - 1 : Number.POSITIVE_INFINITY;
		if (total >= row.after && total <= upper) return row;
	}
	return SHOCK_TABLE[SHOCK_TABLE.length - 1];
}

/** ItemLike shape for the innate-item effect readers below. */
interface FearItemLike {
	name?: string;
	type?: string;
	system?: {
		effects?: Array<{ kind?: string; value?: number }>;
	};
}

/**
 * Whether ANY owned talent carries the given fear effect kind (bead jpbm).
 * Talents and traits are both innate/known items, but the fear-immunity and
 * fear-reroll kinds are talent-consumed (book: Fearless/Unshakeable Faith
 * are talents); traits do not carry them.
 */
function hasTalentFearEffect(actor: unknown, kind: string): boolean {
	const items = (actor as { items?: FearItemLike[] }).items ?? [];
	return items.some((item) =>
		item.type === "talent"
			? (item.system?.effects ?? []).some((e) => e.kind === kind)
			: false,
	);
}

/**
 * Whether the actor is immune to Fear (bead jpbm): a talent effect with kind
 * "fear-immunity" (e.g. the Fearless talent).
 */
export function fearImmune(actor: unknown): boolean {
	return hasTalentFearEffect(actor, "fear-immunity");
}

/**
 * Whether the actor may re-roll failed Fear Tests (Unshakeable Faith, book
 * p108: "may re-roll failed Fear Tests"): kind "fear-reroll".
 */
export function fearReroll(actor: unknown): boolean {
	return hasTalentFearEffect(actor, "fear-reroll");
}

/**
 * Severity modifier as a funnel Modifier row so the dialog/card breakdown
 * shows it explicitly (modifiers must be VISIBLE per AGENTS.md).
 */
export function fearSeverityModifier(rating: number): Modifier {
	return {
		id: "fear:severity",
		source: { type: "item", label: "SOURCE.FROM_TRAITS" },
		label: "FEAR.SEVERITY_LABEL",
		value: fearTestModifier(rating),
	};
}