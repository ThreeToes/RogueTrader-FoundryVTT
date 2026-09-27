/**
 * Modifiers are pure data. Every source (items, effects, dialogs, macros,
 * future careers/rules) expresses contributions uniformly; the funnel sums
 * them and the chat breakdown renders them. FFG modifiers are additive, so
 * `stacking` is reserved for future non-additive types.
 */
export interface Modifier {
	/** Stable id for deduplication, e.g. "accurate:bs-test". */
	id: string;
	/** How this modifier reached the funnel. */
	source: {
		type: "item" | "effect" | "skill" | "dialog" | "macro" | "talent";
		label: string;
	};
	/** Localized label shown on chat cards. */
	label: string;
	value: number;
	/** Optional guard display (CONDITION.* i18n key), e.g. "when charging". */
	condition?: string;
	/** Reserved for future stacking semantics. */
	stacking?: string;
}

/** Sum of additively-stacked modifier values. */
export function sumModifiers(modifiers: Modifier[]): number {
	return modifiers.reduce((total, mod) => total + mod.value, 0);
}
