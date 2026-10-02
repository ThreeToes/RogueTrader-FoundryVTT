/**
 * Ship-weapon range as a min/max band (epic c48r, bead 3atc): Battlefleet
 * Koronus prints extended-range weapons as two-number VU bands — Nova
 * Cannons "6-40"/"6-36"/"6-35" (Mars/Ryza patterns p34, Jovian p42) — so
 * the single NumberField could not carry them. This is the READ shape
 * declared once (mirroring rate-of-fire.ts): the schema in
 * ship-component.ts owns the fields; sheets and roll plumbing import this
 * interface rather than re-declaring the pair.
 */
export interface ShipWeaponRange {
	/** Minimum effective range in VU (the band's lower bound). */
	min: number;
	/** Maximum effective range in VU (the band's upper bound). */
	max: number;
}

/**
 * Legacy/normalised input cleaner for the `range` SchemaField: world docs
 * authored against the old single-number field (or hand-edited values)
 * carry a bare number (or numeric string). It migrates to a symmetric band
 * (min = max = that number), so existing single-number docs keep working.
 * An object source passes through with the numbers coerced; if the band is
 * inverted (min > max) it is swapped — never silently clamped to 0.
 */
export function normalizeShipWeaponRange(value: unknown): ShipWeaponRange {
	if (typeof value === "number" || typeof value === "string") {
		const num = Number(value);
		const range = Number.isFinite(num)
			? { min: num, max: num }
			: { min: 0, max: 0 };
		return swapIfNeeded(range.min, range.max);
	}
	if (value != null && typeof value === "object") {
		const src = value as Record<string, unknown>;
		return swapIfNeeded(
			Number(src.min ?? 0),
			Number(src.max ?? 0),
		);
	}
	return { min: 0, max: 0 };
}

/**
 * Display formatting for the band (epic c48r, bead gq2g): a single-value
 * range (min === max) shows as one number; an extended range shows as
 * 'min-max' — the book's own notation (Battlefleet Koronus p34/p42,
 * e.g. Nova Cannon "6-40" VU). Numeric notation, so no i18n key; callers
 * pass whatever they got (legacy single-number docs included) and it is
 * normalised before formatting — never a raw `[object Object]`.
 */
export function formatShipWeaponRange(range: unknown): string {
	const band = normalizeShipWeaponRange(range);
	return band.min === band.max
		? `${band.min}`
		: `${band.min}-${band.max}`;
}

function swapIfNeeded(min: number, max: number): ShipWeaponRange {
	return Number.isFinite(min) && Number.isFinite(max)
		? min <= max
			? { min, max }
			: { min: max, max: min }
		: { min: 0, max: 0 };
}