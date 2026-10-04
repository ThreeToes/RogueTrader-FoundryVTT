/**
 * Encounter-end status cleanup (bead cneb). Ending a combat encounter (the GM
 * deletes the Combat) removes every combatant's encounter-length conditions —
 * the semantics rules/conditions.ts promises (header comment: "encounter-
 * length conditions carry no expiry — removed when the GM ends the encounter
 * or via snap-out"). Pure mapping: rules/conditions.ts; document writes:
 * here, through the ports' loud-failure contract (bead c9s3).
 *
 * v14.366 runtime hook verified against the installed core foundry.mjs:
 * - the document lifecycle hook is emitted by the database backend's delete
 *   operation as Hooks.callAll(`delete${type}`, doc, options, userId)
 *   (foundry.mjs:81303), with Combat's documentName "Combat" (BaseCombat
 *   metadata name, foundry.mjs:18156) — hence the "deleteCombat" hook;
 * - Combatant's `get actor()` resolves the Token's actor or
 *   game.actors.get(actorId), or null (foundry.mjs:59838-59842) — null
 *   combatants (defeated/unlinked) are skipped;
 * - combat.combatants is the combatants embedded collection
 *   (metadata embedded: {Combatant: "combatants"}, foundry.mjs:18160).
 */

import { encounterEndRemovals } from "../rules/conditions";
import { getPorts } from "../infrastructure/foundry/ports";

/** The combat-walk shape this cleanup needs from a Combat/Combatant document. */
interface CombatantLike {
	/** Actor document the combatant represents (null = unlinked/deleted). */
	actor?: unknown | null;
}

/**
 * Register the deleteCombat listener (adapter side). One executor: the hook
 * fires on every connected client, so only the local driving user writes —
 * the same guard the skill-grant hook uses (bootstrap/hooks.ts).
 */
export function registerCombatEncounterEndHook(): void {
	Hooks.on(
		"deleteCombat",
		(combat: unknown, _options: unknown, userId: string) => {
			if (userId !== (game as { userId?: string }).userId) return;
			removeEncounterLengthConditions(combat).catch((error) =>
				console.error(
					"rogue-trader: encounter-end condition cleanup failed",
					error,
				),
			);
		},
	);
}

/**
 * Remove every combatant's encounter-length conditions from a (deleted)
 * combat: pure mapping picks the effects, the ports do exactly ONE
 * deleteEffects write per distinct actor document (actors can share two
 * combatants via multiple tokens).
 */
export async function removeEncounterLengthConditions(
	combat: unknown,
): Promise<void> {
	const ports = getPorts();
	const combatants = (
		combat as { combatants?: Iterable<CombatantLike> | null } | null
	)?.combatants;
	if (!combatants) return;
	// An actor can hold two combatant slots (multi-token spawns); the second
	// slot must not re-delete ids the first call already removed.
	const written = new Set<unknown>();
	for (const combatant of combatants) {
		const actor = combatant?.actor;
		if (!actor || written.has(actor)) continue;
		written.add(actor);
		const removals = encounterEndRemovals(
			(
				actor as {
					effects?: Array<{
						id?: string;
						statuses?: string[];
						duration?: { rounds?: number | null; seconds?: number | null } | null;
					}>;
				}
			).effects ?? [],
		);
		if (removals.length === 0) continue;
		await ports.actors.deleteEffects(
			actor,
			removals.map((r) => r.id),
		);
	}
}