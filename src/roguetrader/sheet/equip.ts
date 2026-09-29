/**
 * Shared equip-state toggle (bead 73di): ONE state machine for the
 * Character/NPC equip-toggle actions, previously duplicated in
 * npc-inventory.ts and re-implemented inline in CharacterSheet.
 *
 * ARMOUR-AWARE (bead 2dvj): armour cycles worn<->stowed (the only valid
 * armour states — a stowed<->carried toggle produces an invalid "carried"
 * armour state); weapons and gear cycle stowed<->carried. Non-equippable
 * types simply cycle stowed/carried — the sheets' type allowlists decide
 * whether a toggle anchor renders at all.
 */
export function equipToggleState(
	type: string | undefined,
	current: string,
): string {
	if (type === "armour") {
		return current === "worn" ? "stowed" : "worn";
	}
	return current === "stowed" ? "carried" : "stowed";
}