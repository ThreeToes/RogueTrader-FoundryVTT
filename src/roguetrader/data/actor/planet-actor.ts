import { effectsField } from "../item/effects";

/**
 * Planet actor (owner ask, planet tables): a dedicated Actor type for
 * worlds generated with the Stars of Inequity world/planetside generators
 * (SOI Ch I/II). The rolled `game-table` documents from the gametables
 * compendium are attached to the planet as embedded items (drag from the
 * compendium or roll-and-attach) — the table rows are planet-specific
 * records, deliberately NOT plain Gear items.
 *
 * The snapshot fields hold the headline world profile (Body, Gravity,
 * Orbital Feature, Atmosphere, Climate, Habitability, Inhabitants,
 * Development, Territory summary) copied from the drawn table rows; the
 * authoritative row texts live on the attached game-table items.
 */
export class PlanetActor extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["PLANET"];

	declare body: string;
	declare gravity: string;
	declare orbitalFeature: string;
	declare atmosphere: string;
	declare climate: string;
	declare habitability: string;
	declare inhabitants: string;
	declare development: string;
	declare territories: string;
	declare notes: string;

	static override defineSchema() {
		return {
			/** Table 1-6: Body draw (e.g. "Rocky 2-3 Small"). */
			body: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-7: Gravity draw. */
			gravity: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-8: Orbital Features draw. */
			orbitalFeature: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-9/1-10: Atmospheric Presence + Composition draw. */
			atmosphere: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-11: Climate draw. */
			climate: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-12: Habitability draw. */
			habitability: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-26: Inhabitants draw. */
			inhabitants: new foundry.data.fields.StringField({ initial: "" }),
			/** Table 1-27: Development draw. */
			development: new foundry.data.fields.StringField({ initial: "" }),
			/** Territories/terrain summary (Table 1-13/1-14 draws). */
			territories: new foundry.data.fields.StringField({ initial: "" }),
			/** Free-text GM notes. */
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
			effects: effectsField(),
		};
	}
}