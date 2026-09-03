/**
 * Presentation label helpers (pure, unit-testable).
 *
 * adapter.ts cannot be imported by tests (it touches foundry globals at
 * module scope), so pure string helpers live here.
 */

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
