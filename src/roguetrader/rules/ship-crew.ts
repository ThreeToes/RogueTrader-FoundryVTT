/**
 * Crew quality rules (Core Rulebook p193): all ships start Competent;
 * Incompetent grants +5 SP, Crack costs 5 SP, Veteran 15 SP. Pure +
 * testable — lives outside data/actor/starship-actor.ts so roll handlers
 * (and bun tests) can import it without loading a foundry-extended
 * DataModel (bead xfta).
 */

export const CREW_QUALITIES = {
	incompetent: { skill: 20, spDelta: 5 },
	competent: { skill: 30, spDelta: 0 },
	crack: { skill: 40, spDelta: -5 },
	veteran: { skill: 50, spDelta: -15 },
} as const;

export type CrewQuality = keyof typeof CREW_QUALITIES;

/** Crew quality effects (Core Rulebook p193). Pure + testable. */
export function crewQualityEffects(quality: string): {
	skill: number;
	spDelta: number;
} {
	return CREW_QUALITIES[
		(quality as CrewQuality) in CREW_QUALITIES
			? (quality as CrewQuality)
			: "competent"
	];
}