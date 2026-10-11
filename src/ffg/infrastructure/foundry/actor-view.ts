/**
 * Foundry Actor -> ActorView (epic kof0, phase 1).
 *
 * A thin wrapper: the mapping lives in the domain (`domain/model/build.ts`) so
 * tests and the runtime share one definition. This module exists only to accept
 * a Foundry `Actor` and hand its loose shape to the builder.
 *
 * Built once per rules operation (per roll) — cheap and always fresh.
 */

import type {
	ActorSystemView,
	ActorView,
	CharacterActorTypes,
	CharacterSystemView,
	ShipActorTypes,
	ShipSystemView,
	SystemViewBase,
	VehicleActorTypes,
	VehicleSystemView,
} from "../../../ffg/domain/model/actor";
import type { LooseActor } from "../../../ffg/domain/model/build";
import { messageFlagNamespace } from "../../../ffg/application/chat-flags";
import { buildActorView } from "../../../ffg/domain/model/build";
import { getPorts } from "./ports";

/**
 * Statically-known actor families narrow the view at the call site: a fixture
 * or sheet whose actor carries `type: "explorer"` gets a character-family
 * view, with no ship/vehicle fields to misread (bead l2wz). A `fvtt-types`
 * `Actor` cannot narrow below its registered-subtype union, so real runtime
 * call sites fall through to the last overload — but the per-type choice
 * still happens at runtime (below), so the OBJECT carries only its family's
 * claims and nothing the actor does not have.
 */
export function actorView(
	actor: LooseActor & { type: CharacterActorTypes },
): ActorView<CharacterSystemView>;
export function actorView(
	actor: LooseActor & { type: ShipActorTypes },
): ActorView<ShipSystemView>;
export function actorView(
	actor: LooseActor & { type: VehicleActorTypes },
): ActorView<VehicleSystemView>;
export function actorView<S extends SystemViewBase = ActorSystemView>(
	actor: Actor | LooseActor,
): ActorView<S>;
export function actorView(
	actor: Actor | LooseActor,
): ActorView<ActorSystemView> {
	// The flag namespace is profile DATA (bead pwn0): resolved above the domain
	// here (this is the infrastructure layer that owns the ports), passed in so
	// the domain mapping never hardcodes a system id.
	const loose = actor as LooseActor;
	const options = { flagNamespace: messageFlagNamespace(getPorts()) };
	// Per-actor.type discrimination (bead l2wz): each family instantiates the
	// family's system view, so a ship never claims character fields and a
	// character never claims ship fields. The type strings mirror the registry
	// (bootstrap/sheet-registry.ts) and its foundry.d.ts mirror
	// (foundry-types.test.ts keeps those two in sync). Families without RT
	// family models (dynasty, planet, cache) build a bare base view.
	switch (String(actor.type)) {
		case "starship":
			return buildActorView<ShipSystemView>(loose, options);
		case "vehicle":
			return buildActorView<VehicleSystemView>(loose, options);
		case "pc":
		case "explorer":
		case "npc":
			return buildActorView<CharacterSystemView>(loose, options);
		default:
			return buildActorView<SystemViewBase>(loose, options);
	}
}