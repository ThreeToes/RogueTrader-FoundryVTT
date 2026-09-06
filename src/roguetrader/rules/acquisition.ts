/**
 * Acquisition rules (bead gjvg, Core Rulebook p271-273 = book pages 146-148 and
 * Table 1-5 p33).
 *
 * An Acquisition Test is a 1d100 roll against the group's Profit Factor,
 * modified by the item's Availability, the scale of the request, and its
 * Craftsmanship (Table 9-35). Bonuses raising the effective target to 100+
 * succeed automatically; penalties reducing it to 0 or less fail
 * automatically. Everything here is pure; Foundry coupling stays in the UI.
 */

/** Table 9-35: Acquisition Modifiers (availability ladder). */
export const AVAILABILITY_MODIFIERS: Readonly<Record<string, number>> = {
	ubiquitous: 70,
	abundant: 50,
	plentiful: 30,
	common: 20,
	average: 10,
	scarce: 0,
	rare: -10,
	"very-rare": -20,
	"extremely-rare": -30,
	"near-unique": -50,
	unique: -70,
};

/** Table 9-35 scale modifiers (named scales; numeric quantities map below). */
export const SCALE_MODIFIERS: Readonly<Record<string, number>> = {
	negligible: 30,
	trivial: 20,
	minor: 10,
	standard: 0,
	major: -10,
	significant: -20,
	vast: -30,
};

/** Table 9-35 craftsmanship modifiers. */
export const CRAFTSMANSHIP_MODIFIERS: Readonly<Record<string, number>> = {
	poor: 10,
	common: 0,
	good: -10,
	best: -30,
};

/** Table 1-5: Starting Profit Factor and Ship Points (p33, 1d10). */
export function startingProfitFactorAndShipPoints(roll: number): {
	profitFactor: number;
	shipPoints: number;
} {
	const r = Math.min(10, Math.max(1, roll));
	if (r === 1) return { profitFactor: 60, shipPoints: 30 };
	if (r <= 3) return { profitFactor: 50, shipPoints: 40 };
	if (r <= 7) return { profitFactor: 40, shipPoints: 50 };
	if (r <= 9) return { profitFactor: 30, shipPoints: 60 };
	return { profitFactor: 20, shipPoints: 70 };
}

export interface AcquisitionContext {
	profitFactor: number;
	availabilityModifier?: number;
	scaleModifier?: number;
	craftsmanshipModifier?: number;
	/** Any additional situational modifiers (rare access talents, etc.). */
	extra?: number;
}

export interface AcquisitionEvaluation {
	/** Profit Factor + total modifiers. */
	target: number;
	modifiers: number;
	/** "success" / "failure" when the test resolves without a roll. */
	automatic: "success" | "failure" | null;
}

/** Effective acquisition target + auto success/failure band (p272-273). */
export function acquisitionTarget(context: AcquisitionContext): AcquisitionTargetResult {
	const modifiers =
		(context.availabilityModifier ?? 0) +
		(context.scaleModifier ?? 0) +
		(context.craftsmanshipModifier ?? 0) +
		(context.extra ?? 0);
	const target = context.profitFactor + modifiers;
	const automatic =
		target >= 100 ? "success" : target <= 0 ? "failure" : null;
	return { target, modifiers, automatic };
}

export type AcquisitionTargetResult = {
	target: number;
	modifiers: number;
	automatic: "success" | "failure" | null;
};

/** Resolve a rolled Acquisition Test (1d100 roll vs target). */
export function resolveAcquisition(
	context: AcquisitionContext,
	roll: number,
): AcquisitionTargetResult & { success: boolean } {
	const base = acquisitionTarget(context);
	const automatic = base.automatic;
	const success =
		automatic === "success"
			? true
			: automatic === "failure"
				? false
				: roll <= base.target;
	return { ...base, success };
}

/** Modifier for an item availability string (unknown -> null, never guess). */
export function availabilityModifier(availability: string): number | null {
	return AVAILABILITY_MODIFIERS[availability] ?? null;
}