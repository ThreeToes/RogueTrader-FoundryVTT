/**
 * Item effect rows (the domain's plain shape) — `EffectData` and the pure
 * helpers over it.
 *
 * These lived in `data/item/effects.ts` next to the Foundry schema factory.
 * They are domain concepts (rules read them; the schema merely persists them),
 * so they live here and the schema module re-exports them for compatibility.
 */

export interface EffectData {
	kind?: string;
	testKey?: string | null;
	value?: number;
	/** Dice expression for effects the book prints as dice (e.g. "1d10+4"). */
	dice?: string;
	label?: string;
	/** Guard: only applies when the matching context flag is set. */
	condition?: string;
}

/**
 * Item types whose effects are always live (known, not carried).
 * Talents and psychic powers are "known"; rulebook traits, mutations and
 * madness entries are innate conditions the actor always has.
 */
const INNATE_EFFECT_TYPES: ReadonlySet<string> = new Set([
	"talent",
	"psychicpower",
	"trait",
	"mutation",
	"madnessentry",
]);

/** Physical item types -> the equip state that makes their effects live. */
const EQUIP_STATES_FOR_EFFECTS: Readonly<Record<string, readonly string[]>> = {
	armour: ["worn"],
	gear: ["carried"],
	"melee-weapon": ["carried"],
	"ranged-weapon": ["carried"],
};

/**
 * Whether an owned item of `itemType` in `equipState` contributes its effects.
 * Innate types are always live; physical types contribute when equipped;
 * unknown types never contribute (opt-in via the table above).
 */
export function effectsAreLive(
	itemType: string | undefined,
	equipState: string | undefined,
): boolean {
	if (itemType && INNATE_EFFECT_TYPES.has(itemType)) return true;
	const states = itemType ? EQUIP_STATES_FOR_EFFECTS[itemType] : undefined;
	return states !== undefined && states.includes(equipState ?? "");
}

/**
 * Dice expressions contributed by "corruption" effect rows (epic 0hap): the
 * Summon Daemon power prints "1d10+4 Corruption Points" (EA p83). Pure: the
 * caller rolls the expressions. `dice` wins; an integer `value` is the fallback.
 */
export function corruptionExpressions(
	effects: EffectData[] | undefined,
): string[] {
	const out: string[] = [];
	for (const effect of effects ?? []) {
		if (effect.kind !== "corruption") continue;
		const dice = (effect.dice ?? "").trim();
		if (dice) out.push(dice);
		else if (typeof effect.value === "number" && effect.value !== 0) {
			out.push(String(effect.value));
		}
	}
	return out;
}

/** Blank effect row for the sheets' add-effect control (schema defaults). */
export function blankEffect(): Required<EffectData> {
	return {
		kind: "test-modifier",
		testKey: "",
		value: 0,
		dice: "",
		label: "",
		condition: "",
	};
}

/** Effects list with a blank row appended (pure; sheet add-effect action). */
export function withAddedEffect(
	effects: EffectData[] | undefined,
): EffectData[] {
	return [...(effects ?? []), blankEffect()];
}

/** Effects list minus the row at `index` (pure; sheet remove control). */
export function withoutEffectAt(
	effects: EffectData[],
	index: number,
): EffectData[] {
	return effects.filter((_, i) => i !== index);
}
