/**
 * Cache actor (bead wlx9): a lootable container on the map — a crate, a
 * corpse's kit, a smuggler's stash, a wrecked vehicle's hold.
 *
 * WHY AN ACTOR AND NOT AN ITEM: Foundry can only place Actors on the canvas. A
 * container Item cannot be dropped on a scene as a token, so it cannot be the
 * thing a player clicks on the map. An Actor is the only shape that gives
 * "on the map" AND "has an inventory".
 *
 * DELIBERATELY MECHANIC-FREE. No characteristics, no skills, no derived stats,
 * no wounds, no initiative, no effects. It exists to be opened and emptied, and
 * it must NEVER offer a Test. Two things enforce that from opposite sides:
 * this model has no field a roll could read, and the roll pipeline refuses an
 * actor the current user does not own (bead qiuo) — a cache is normally owned
 * by nobody.
 *
 * The books do not define a "cache"; this is a GM tool, so the schema holds
 * only what a GM actually needs. Resisting the urge to add capacity, weight or
 * currency fields is deliberate: a cache is not a vessel hold, and a stack of
 * thrones can be an ordinary Gear item inside it.
 */
export class CacheActor extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["CACHE"];

	/** Free-text GM notes: what this is, who left it, what it is worth. */
	declare notes: string;

	static override defineSchema() {
		return {
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}
}
