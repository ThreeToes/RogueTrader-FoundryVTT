import type { Modifier } from "../../../packages/rules-engine/src/modifier";

/**
 * Modifier funnel: the single collection point between the system's data and
 * the rules engine. Sources push `Modifier` values in; consumers (roll
 * dialogs, chat cards) receive an ordered breakdown and a total.
 *
 * Foundry-facing sources (items, ActiveEffects, talents) register their
 * contributions here as the system grows; the funnel is the stable contract
 * so those additions never touch sheet or roll code.
 */
export interface ModifierSource {
	type: Modifier["source"]["type"];
	label: string;
}

/**
 * Collect modifiers for a test.
 *
 * v1 sources: caller-provided modifiers (roll dialog, macros). Item/effect
 * sources plug in here as data later via registered collector functions.
 */
export function collectTestModifiers(
	_actor: unknown,
	_key: string,
	extra: Modifier[] = [],
): Modifier[] {
	return [...extra];
}

/** Merge de-duplicating by modifier id (first registration wins). */
export function mergeModifiers(
	first: Modifier[],
	second: Modifier[],
): Modifier[] {
	const seen = new Map<string, Modifier>();
	for (const mod of [...first, ...second]) {
		if (!seen.has(mod.id)) seen.set(mod.id, mod);
	}
	return [...seen.values()];
}

/** Ordered {label, value} breakdown for chat cards. */
export function breakdown(
	modifiers: Modifier[],
): Array<{ label: string; value: number }> {
	return modifiers.map((mod) => ({ label: mod.label, value: mod.value }));
}
