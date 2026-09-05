/**
 * Insanity & corruption track data (beads 06qc/e6x9): rows for Table 10-5
 * (Insanity Track), Table 10-6 (Mental Traumas), the Mental Disorders list
 * (p296-298), and Table 10-7 (Corruption Track). All verbatim; mechanics
 * stay in text until effect machinery consumes them (epic 1g2t).
 */
import { Gear } from "./gear";

export class MadnessEntry extends Gear {
	static LOCALIZATION_PREFIXES = ["MADNESS"];

	declare kind: string;
	declare rollMin: number;
	declare rollMax: number;
	declare degree: string;
	declare modifier: number;
	declare severity: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** insanity-track | trauma | disorder | corruption-track */
			kind: new foundry.data.fields.StringField({ initial: "note" }),
			/** Inclusive d100 band (tracks and traumas). */
			rollMin: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			rollMax: new foundry.data.fields.NumberField({
				min: 0,
				max: 999,
				integer: true,
				initial: 999,
			}),
			/** Degree of Madness / Corruption label. */
			degree: new foundry.data.fields.StringField({ initial: "" }),
			/** Test modifier the degree applies (0 = none). */
			modifier: new foundry.data.fields.NumberField({
				min: -100,
				integer: true,
				initial: 0,
			}),
			/** Disorder severity (minor | severe | acute | severe-acute). */
			severity: new foundry.data.fields.StringField({ initial: "" }),
		};
	}
}
