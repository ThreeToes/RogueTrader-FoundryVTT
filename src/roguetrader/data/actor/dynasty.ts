import { effectsField } from "../item/effects";

/**
 * Group record (bead gjvg, owner decision 2026-09-05): a dedicated
 * party/dynasty document holding the group's Profit Factor and Ship Points
 * (rt_core p271 book p146; Table 1-5 p33). PF is shared by the Explorers
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