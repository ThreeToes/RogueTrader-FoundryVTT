import { effectsField, type EffectData } from "./effects";
import { sourceField } from "./source";

/**
 * Rulebook traits (bead 25ii): innate creature features from the Core
 * Rulebook statblocks (Ch XIV) — Machine (6), Unnatural Toughness (×2),
 * Fear, Darksight, Flyer (2), Sturdy, ... NPC statblocks embed them as
 * owned `trait` items.
 *
 * Traits are INNATE: unlike physical items they have no equip state, so
 * effectsAreLive treats `trait` as an always-live type (data/item/effects.ts)
 * — a trait's effect rows feed the funnel the moment the actor owns the item
 * (that wiring is bead zyv1; this model is the data substrate).
 *
 * Two-flavours text (bead 707 convention, same as talents): `benefit` is the
 * terse verbatim statblock phrasing ("6", "×2", "Null gravity conditions
 * only"); `description` is the long book prose (HTML, prose-mirror
 * round-trip).
 */
export class Trait extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["TRAIT"];

	declare benefit: string;
	declare shortDescription: string;
	declare description: string;
	declare effects: EffectData[];

	static override defineSchema() {
		return {
			/** Terse verbatim statblock phrasing (parameterized traits carry the
			 * parameter here, e.g. Machine (6) -> "6"). */
			benefit: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * Effect list: {kind, testKey, value, label, condition} — the shared
			 * shape (data/item/effects.ts). Mechanical traits (Machine, Fear,
			 * Unnatural ...) carry rows; display-only traits (Darksight) keep
			 * prose only. Raw capture; the funnel bead (zyv1) wires consumption.
			 */
			effects: effectsField(),
			// Source attribution (bead zzlq): books.yaml slug + printed page.
			source: sourceField(),
			/** Short free-text summary (pickers/list display). */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Long book prose (HTML). */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}
}