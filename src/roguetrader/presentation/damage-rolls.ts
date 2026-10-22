/**
 * Foundry-bound damage-roll wrappers (bead x4ly) — the port-binding edge.
 *
 * `rollWeaponDamage` / `rollDamageForCard` used to live in rules/adapter.ts,
 * where the rules layer called the global `getPorts()` accessor directly,
 * which made a second FFG system fork the rules layer to bind its OWN port
 * set. The wrappers are presentation: they read the global `getPorts()` here
 * — the layer that is allowed to own it — bind it onto the adapter call, and
 * `rules/adapter.ts` re-exports these names so every established import path
 * keeps working until callers migrate.
 */

import { attackProfileOf } from "../../ffg/domain/model/attack";
import type { DamageRollFlag } from "../rules/chat-flags";
import { postWeaponDamage } from "../rules/adapter";
import { equipStateOf, ownedItemResolver } from "../data/accessors";
import { getPorts } from "../infrastructure/foundry/ports";

/**
 * Resolve a uuid stored on a chat flag to a document.
 *
 * fvtt-types types `fromUuidSync`'s parameter as a template-literal UUID union,
 * but a flag carries an arbitrary string, so the cast belongs at this one
 * boundary rather than at each call site.
 */
export function documentFromUuid(uuid: string): unknown {
	return foundry.utils.fromUuidSync(uuid as never);
}

export async function rollWeaponDamage(
	actor: Actor,
	weaponId: string,
): Promise<void> {
	const ports = getPorts();
	const item = actor.items.get(weaponId);
	// Bead 6l68: the item gate comes FIRST — attackProfileOf tolerates
	// null/undefined only as an incidental detail of its signature, and we
	// do not rely on it. The profile is resolved from a verified item.
	if (!item) {
		ports.notify.warn("ROLL.UNKNOWN_ITEM");
		return;
	}
	// Bead kam1: a MUTATION with a printed attack block (Corrosive Bile) is an
	// attack too, so it resolves through the same profile as a weapon. Bead
	// 4obp: the launcher's fire profile derives from its LOADED ordnance —
	// unloaded = unusable and the damage roll below refuses.
	// Bead huaf/ujtg: the owner resolver doubles as the mod resolver —
	// attached weapon modifications (pen-flat/primitive-clear) fold in here.
	const profile = attackProfileOf(
		item as never,
		ownedItemResolver(actor),
		ownedItemResolver(actor) as never,
	);
	if (!profile) {
		ports.notify.warn("ROLL.UNKNOWN_ITEM");
		return;
	}
	// Carry gating matches the to-hit attack gate; innate attacks (mutations)
	// are part of the body and are never equipped.
	if (!profile.innate && equipStateOf(item) !== "carried") {
		ports.notify.warn("ROLL.NOT_CARRIED", { weapon: item.name ?? "" });
		return;
	}
	// Hit location needs a d100; a direct damage roll has no to-hit test, so
	// the throwaway d100 is rolled INSIDE postWeaponDamage (bead 9b95 F7:
	// after the consume/refuse gates) — pass null to let it roll.
	const target = ports.targets.actor() as Actor | null;
	await postWeaponDamage(
		actor,
		(target ?? actor) as Actor,
		profile,
		null,
		false,
		undefined,
		undefined,
		ports,
	);
}

/**
 * Damage roll triggered from the to-hit card's button (owner redesign).
 * Consumes the flag data set at attack time; rolls the weapon's damage
 * formula, picks the hit location, resolves vs armour/toughness and
 * posts the damage card with the apply-damage button.
 */
export async function rollDamageForCard(data: DamageRollFlag): Promise<void> {
	const attacker = data.attackerUuid
		? (documentFromUuid(data.attackerUuid) as Actor | null)
		: null;
	const weapon = data.weaponUuid
		? (documentFromUuid(data.weaponUuid) as foundry.documents.Item | null)
		: null;
	// Bead 4obp: resolve the launcher's loaded ordnance against its owning
	// actor (embedded weapons carry .actor; unowned items cannot have loaded
	// ordnance resolved at all).
	const owner = (weapon as { actor?: foundry.documents.Actor | null } | null)
		?.actor;
	// Bead 6l68: the document gates come FIRST — a missing resolvee returns
	// outright instead of calling attackProfileOf on a null/undefined weapon
	// and reading its tolerance as the contract.
	if (!attacker || !weapon) return;
	// Bead huaf/ujtg: the owner resolver doubles as the mod resolver.
	const profile = attackProfileOf(
		weapon as never,
		owner ? ownedItemResolver(owner) : undefined,
		owner ? (ownedItemResolver(owner) as never) : undefined,
	);
	if (!profile) return;
	const ports = getPorts();
	if (profile.unusable) {
		ports.notify.warn("ROLL.LAUNCHER_UNLOADED", { weapon: profile.name });
		return;
	}
	const target = data.targetUuid
		? (documentFromUuid(data.targetUuid) as Actor | null)
		: null;
	await postWeaponDamage(
		attacker,
		(target ?? attacker) as Actor,
		profile,
		data.hitRoll ?? 0,
		data.critical === true,
		// Bead 9b95 F6: the to-hit dialog's fire mode, stamped onto the flag.
		data.fireMode,
		// Bead gqz2: the to-hit dialog's condition flags, stamped onto the
		// flag so guarded damage rows can fire on the damage channel.
		data.flags,
		ports,
	);
}