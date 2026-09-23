import { effectsField } from "../item/effects";
import { textField } from "../fields";

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
			body: textField(),
			/** Table 1-7: Gravity draw. */
			gravity: textField(),
			/** Table 1-8: Orbital Features draw. */
			orbitalFeature: textField(),
			/** Table 1-9/1-10: Atmospheric Presence + Composition draw. */
			atmosphere: textField(),
			/** Table 1-11: Climate draw. */
			climate: textField(),
			/** Table 1-12: Habitability draw. */
			habitability: textField(),
			/** Table 1-26: Inhabitants draw. */
			inhabitants: textField(),
			/** Table 1-27: Development draw. */
			development: textField(),
			/** Territories/terrain summary (Table 1-13/1-14 draws). */
			territories: textField(),
			/** Free-text GM notes. */
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
			effects: effectsField(),
		};
	}
}