/**
 * Insanity / Corruption track arithmetic (bead u9fz).
 *
 * Both tracks are monotonic point counters that cannot go negative, so the
 * clamp lives here ONCE rather than differing per caller (fear.ts used to
 * add without clamping, psychic-support.ts clamped).
 */
import type { Actors } from "./ports";

/** The character system fields this module adjusts. */
export type TrackField = "insanity" | "corruption";

/**
 * Add `delta` to the actor's insanity/corruption track, clamped at 0, and
 * persist it through the Actors port. Non-finite or zero deltas are a
 * no-op (no write). Returns the amount actually applied (0 for a no-op).
 */
export async function adjustTrack(
	actors: Actors,
	actor: unknown,
	field: TrackField,
	delta: number,
): Promise<number> {
	if (!Number.isFinite(delta) || delta === 0) return 0;
	const system = (actor as { system?: Record<string, unknown> } | null)
		?.system ?? {};
	const raw = Number(system[field]);
	const current = Number.isFinite(raw) ? raw : 0;
	await actors.update(actor, {
		[`system.${field}`]: Math.max(0, current + delta),
	});
	return delta;
}