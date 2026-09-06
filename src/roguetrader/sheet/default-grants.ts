/**
 * Default-skill grant tracking (bead t093 follow-up): the createActor hook
 * grants common skills ASYNCHRONOUSLY — Foundry resolves Actor.create()
 * without awaiting hook handlers, so code running right after creation (the
 * character creator's grant merge) must be able to wait for the defaults to
 * land before deduping against live items.
 */

const pendingDefaultGrants = new Map<string, Promise<unknown>>();

/** Record a default-grant promise for an actor (called by the hook). */
export function trackDefaultGrants(
	actorUuid: string,
	promise: Promise<unknown>,
): void {
	pendingDefaultGrants.set(actorUuid, promise);
}

/**
 * Resolve when the hook's default-skill grant for this actor has finished
 * (immediately when the actor never received one).
 */
export async function waitForDefaultGrants(
	actorUuid: string | undefined,
): Promise<void> {
	const pending = actorUuid ? pendingDefaultGrants.get(actorUuid) : undefined;
	if (pending) {
		try {
			await pending;
		} finally {
			pendingDefaultGrants.delete(actorUuid ?? "");
		}
	}
}