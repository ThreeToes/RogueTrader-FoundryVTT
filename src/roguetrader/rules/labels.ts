/**
 * Presentation label helpers (pure, unit-testable).
 *
 * adapter.ts cannot be imported by tests (it touches foundry globals at
 * module scope), so pure string helpers live here.
 */

import { talentConditions } from "../registry";

/**
 * Convert a dot-notation-free location slug into its i18n key suffix.
 * "left-arm" -> "LEFT_ARM", "head" -> "HEAD".
 */
export function locationKeySuffix(location: string): string {
	return location
		.split("-")
		.map((part) => part.toUpperCase())
		.join("_");
}

/** Full i18n key for a body location, e.g. "left-arm" -> "BODY_LOCATION.LEFT_ARM". */
export function bodyLocationLabelKey(location: string): string {
	return `BODY_LOCATION.${locationKeySuffix(location)}`;
}

/**
 * Full i18n key for a characteristic, e.g. "wp" -> "CHARACTERISTIC.WP"
 * (bead iktx): the ONE composition seam replacing the hand-built
 * `CHARACTERISTIC.${key.toUpperCase()}` template literal at every site.
 */
export function characteristicLabelKey(key: string): string {
	return `CHARACTERISTIC.${key.toUpperCase()}`;
}

/**
 * Registry-seam condition label lookup: a guarded contributor's `condition`
 * carries the raw talentConditions registry slug (e.g. "charging"); this
 * maps it to its i18n label key exactly like the to-hit dialog's seam, and
 * falls back to the raw key so an unregistered slug stays visible instead
 * of silently vanishing.
 */
export function conditionLabel(key: string): string {
	return talentConditions.get(key) ?? key;
}
