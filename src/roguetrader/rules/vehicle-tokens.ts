/**
 * Size category -> battle-map token footprint (bead yyd1).
 *
 * Rogue Trader gives every character, creature and vehicle a size category
 * (Core Rulebook Table 9-9 "Target Size Modifiers" and Table 14-2 "Size").
 * That category already sets the to-hit modifier and the base-movement
 * adjustment; this module turns it into the Foundry `prototypeToken`
 * width/height (in GRID SQUARES) so a vehicle dropped on a battle map
 * occupies a footprint that matches how big it is.
 *
 * The convention is one grid square per +10 of size modifier, never below 1:
 *
 *   Size         Modifier   Footprint
 *   Miniscule      -30       1 x 1
 *   Puny           -20       1 x 1
 *   Scrawny        -10       1 x 1
 *   Average        +-0       1 x 1
 *   Hulking        +10       2 x 2
 *   Enormous       +20       3 x 3
 *   Massive        +30       4 x 4
 *   Immense        +40       5 x 5
 *   Monumental     +50       6 x 6
 *   Titanic        +60       7 x 7
 *
 * The table is keyed by the modifier (not by a hand-written size) so the rule
 * is expressed once and any future category only needs its modifier. `size` is
 * free text on the data model (the book labels statblocks loosely), so an
 * unknown or blank value falls back to Average (1x1) rather than throwing.
 *
 * Scope: vehicles only. Starships are deliberately excluded — void combat is
 * fought at a different scale and the Starship actor carries no size category,
 * so their tokens keep Foundry's default footprint (the GM sets it per scene).
 */

/** Core Rulebook size category -> to-hit modifier (Table 9-9, printed p249). */
export const SIZE_MODIFIERS: Readonly<Record<string, number>> = {
	minuscule: -30,
	puny: -20,
	scrawny: -10,
	average: 0,
	hulking: 10,
	enormous: 20,
	massive: 30,
	immense: 40,
	monumental: 50,
	titanic: 60,
};

/** Footprint of an average-sized actor: one grid square. */
export const DEFAULT_TOKEN_FOOTPRINT = 1;

/**
 * Grid footprint (width == height) for a printed size category, in squares.
 * Average and anything Miniscule..Scrawny clamp to 1; unknown/blank -> 1.
 */
export function vehicleTokenFootprint(size: string | null | undefined): {
	width: number;
	height: number;
} {
	const modifier = SIZE_MODIFIERS[String(size ?? "").trim().toLowerCase()];
	const side = Math.max(
		DEFAULT_TOKEN_FOOTPRINT,
		DEFAULT_TOKEN_FOOTPRINT + Math.floor((modifier ?? 0) / 10),
	);
	return { width: side, height: side };
}

/**
 * Human-readable footprint label for the sheet ("3 x 3"). Used by the vehicle
 * header so the derived size is visible next to the Size field.
 */
export function tokenFootprintLabel(size: string | null | undefined): string {
	const { width, height } = vehicleTokenFootprint(size);
	return `${width} x ${height}`;
}
