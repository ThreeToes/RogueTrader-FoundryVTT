/**
 * Mutation table rows (bead bfdz): data for Table 14-3: Mutations (Core
 * p368-369) and later the Navigator set (Table 7-1). Rows are looked up by
 * d100 roll (corruption-track rolls, Tainted birthright). Text is verbatim;
 * mechanical hooks stay in `text` until effect kinds exist for them.
 */
import { Gear } from "./gear";

export class Mutation extends Gear {
	static LOCALIZATION_PREFIXES = ["MUTATION"];

	declare tableKey: string;
	declare rollMin: number;
	declare rollMax: number;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Which table the row belongs to ("mutations" | "navigator-mutations"). */
			tableKey: new foundry.data.fields.StringField({ initial: "mutations" }),
			/** Inclusive d100 band. */
			rollMin: new foundry.data.fields.NumberField({
				min: 1,
				max: 100,
				integer: true,
				initial: 1,
			}),
			rollMax: new foundry.data.fields.NumberField({
				min: 1,
				max: 100,
				integer: true,
				initial: 100,
			}),
		};
	}
}
