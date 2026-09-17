import { effectsField } from "../item/effects";

/**
 * Group record (bead gjvg, owner decision 2026-09-05): a dedicated
 * party/dynasty document holding the group's Profit Factor and Ship Points
 * (Core Rulebook p271 book p146; Table 1-5 p33). PF is shared by the Explorers
 * ("all the Explorers have the same level of access", p272). Ship Points
 * gate the starting starship purchase (Chapter VIII); unspent SP convert
 * to PF 1:1 (p33).
 */
export class Dynasty extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["DYNASTY"];

	declare profitFactor: number;
	declare shipPoints: { total: number; spent: number };
	declare notes: string;
	/**
	 * Ship & Warrant Path provenance (Into the Storm pp33-44): row id ->
	 * chosen option key, plus the totals that path produced. The top-level
	 * profitFactor/shipPoints above stay the APPLIED values; this is the
	 * record of how they were derived (bead 5pnl).
	 */
	declare warrant: {
		picks: Record<string, string>;
		shipPoints: number;
		profitFactor: number;
	};

	static override defineSchema() {
		return {
			/** Group Profit Factor (Table 1-5 + origin deltas + unspent SP). */
			profitFactor: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 40,
				required: true,
			}),
			shipPoints: new foundry.data.fields.SchemaField({
				total: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 50,
					required: true,
				}),
				spent: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
			}),
			/**
			 * Ship & Warrant Path record (bead 5pnl). `picks` maps a chart row id
			 * (warrant-age | fortune-fate | acquisition | sanction | contacts |
			 * renown) to the chosen option key; the totals are the path's derived
			 * starting values. A blank record is the safe default for every
			 * existing dynasty actor.
			 */
			warrant: new foundry.data.fields.SchemaField({
				picks: new foundry.data.fields.TypedObjectField(
					new foundry.data.fields.StringField({ initial: "" }),
					{ initial: () => ({}) },
				),
				shipPoints: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				profitFactor: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			/** Free-text dynasty notes (Warrant details, holdings...). */
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
			effects: effectsField(),
		};
	}

	/** Ship Points remaining for the starship purchase. */
	get shipPointsRemaining(): number {
		return Math.max(0, this.shipPoints.total - this.shipPoints.spent);
	}
}