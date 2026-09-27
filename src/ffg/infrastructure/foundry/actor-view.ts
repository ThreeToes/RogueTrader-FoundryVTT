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
	SystemViewBase,
} from "../../../ffg/domain/model/actor";
import { messageFlagNamespace } from "../../../ffg/application/chat-flags";
import {
	buildActorView,
	type LooseActor,
} from "../../../ffg/domain/model/build";
import { getPorts } from "./ports";

/** Snapshot a Foundry Actor into the typed, Foundry-free read model. */
export function actorView<S extends SystemViewBase = ActorSystemView>(
	actor: Actor,
): ActorView<S> {
	// The flag namespace is profile DATA (bead pwn0): resolved above the domain
	// here (this is the infrastructure layer that owns the ports), passed in so
	// the domain mapping never hardcodes a system id.
	return buildActorView<S>(actor as unknown as LooseActor, {
		flagNamespace: messageFlagNamespace(getPorts()),
	});
}
