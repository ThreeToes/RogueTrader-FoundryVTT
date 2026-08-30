/**
 * Talent effect-handler registry - the extension seam for non-modifier talent
 * effects (alongside EntryRegistry for content and funnel contributors for
 * test modifiers).
 *
 * Handlers are registered by KIND (e.g. "wounds-max", "skill-rank") at init
 * via CONFIG.ROGUE_TRADER.talentEffectHandlers (attached in sheet/init.ts).
 * Each handler receives (actor, talent, effect) and returns a pure derived
 * contribution; consumers (rules/derived.ts, sheets) aggregate. Handlers never
 * mutate documents.
 */

export interface TalentEffectLike {
	kind?: string;
	testKey?: string | null;
	value?: number;
	label?: string;
}

export interface TalentLike {
	name?: string;
	system?: { effects?: TalentEffectLike[] };
}

export type TalentEffectHandler = (
	actor: unknown,
	talent: TalentLike,
	effect: TalentEffectLike,
) => unknown;

const handlersByKind = new Map<string, TalentEffectHandler[]>();

export const talentEffectHandlers = {
	/** Register a handler for an effect kind. Repeat adds to that kind. */
	register(kind: string, handler: TalentEffectHandler): void {
		const fns = handlersByKind.get(kind) ?? [];
		fns.push(handler);
		handlersByKind.set(kind, fns);
	},
	/** Effect kinds with at least one handler. */
	kinds(): string[] {
		return [...handlersByKind.keys()];
	},
	/**
	 * Run every handler registered for the effect's kind; results aggregated
	 * by summation. Unknown kinds are ignored (modules add their own).
	 */
	run(actor: unknown, talent: TalentLike, effect: TalentEffectLike): unknown[] {
		const results: unknown[] = [];
		const kind = effect.kind ?? "";
		for (const handler of handlersByKind.get(kind) ?? []) {
			const result = handler(actor, talent, effect);
			if (result !== undefined && result !== null) results.push(result);
		}
		return results;
	},
};

// ---------------------------------------------------------------------------
// Reference handlers.
// ---------------------------------------------------------------------------

/** "wounds-max": additive wound levels (Sound Constitution style). */
talentEffectHandlers.register("wounds-max", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 1);
	return Number.isFinite(value) && value !== 0 ? value : null;
});

/** "skill-rank": additive skill ladder bonus for the keyed characteristic tests. */
talentEffectHandlers.register("skill-rank", (_actor, _talent, effect) => {
	const value = Number(effect.value ?? 0);
	return Number.isFinite(value) && value !== 0 ? value : null;
});