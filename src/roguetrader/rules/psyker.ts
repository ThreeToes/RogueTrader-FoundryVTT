import { effectiveSorceryRank } from "./casting";
import { collectSorceryRank } from "./talent-effects";
import type { ActorView } from "../domain/model/actor";

/**
 * Is this actor a psyker for UI purposes (bead n9x7)?
 *
 * One predicate for both the psychic-tab gate and `context.isPsyker` on the
 * PC and NPC sheets. The two hand-written copies had DRIFTED (the NPC copy
 * dropped the sorcery terms), so an actor holding a Sorcery talent showed no
 * psychic UI on the NPC sheet.
 *
 * True when ANY of: the stored psyker flag, a Psy Rating of 1+, a stored or
 * talent-derived Sorcery rank, or ownership of a psychic/navigator power.
 * Navigators count as psykers (Core Rulebook p182).
 */
export function isPsykerLike(view: ActorView): boolean {
	const system = view.system;
	return (
		system.psyker === true ||
		(system.psyRating ?? 0) >= 1 ||
		effectiveSorceryRank(
			collectSorceryRank(view),
			typeof system.sorceryRank === "string" ? system.sorceryRank : undefined,
		) !== "" ||
		view.items.some(
			(item) => item.type === "psychicpower" || item.type === "navigatorpower",
		)
	);
}