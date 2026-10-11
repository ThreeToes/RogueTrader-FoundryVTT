import { effectiveSorceryRank } from "./casting";
import { collectSorceryRank } from "./talent-effects";
import type { ActorView } from "../../ffg/domain/model/actor";
import { isCharacterView } from "../../ffg/domain/model/actor";

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
	// Bead l2wz: the view's system now types as the family union, so character
	// fields need narrowing. Non-character families still count via owned
	// psychic/navigator powers (as the unconditional item scan did before).
	const system = isCharacterView(view) ? view.system : undefined;
	return (
		system?.psyker === true ||
		(system?.psyRating ?? 0) >= 1 ||
		effectiveSorceryRank(
			collectSorceryRank(view),
			typeof system?.sorceryRank === "string" ? system.sorceryRank : undefined,
		) !== "" ||
		view.items.some(
			(item) => item.type === "psychicpower" || item.type === "navigatorpower",
		)
	);
}
