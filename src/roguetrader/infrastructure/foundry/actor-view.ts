/**
 * Foundry Actor -> ActorView (epic kof0, phase 1).
 *
 * A thin wrapper: the mapping lives in the domain (`domain/model/build.ts`) so
 * tests and the runtime share one definition. This module exists only to accept
 * a Foundry `Actor` and hand its loose shape to the builder.
 *
 * Built once per rules operation (per roll) — cheap and always fresh.
 */

import type { Actor } from "fvtt-types/documents";
import type { ActorView } from "../../domain/model/actor";
import { buildActorView, type LooseActor } from "../../domain/model/build";

/** Snapshot a Foundry Actor into the typed, Foundry-free read model. */
export function actorView(actor: Actor): ActorView {
	return buildActorView(actor as unknown as LooseActor);
}
