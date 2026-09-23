import { textField } from "../fields";
import { Gear } from "./gear";

/**
 * Ship & Warrant Path option (Into the Storm Chapter I, printed pp33-44): one
 * Item per chart option, read at creation time by the Warrant creator and by
 * the Dynasty sheet. The verbatim book text lives in the private `warrant`
 * pack; `rules/warrant.ts` keeps the pure machinery (row order, adjacency,
 * resolver).
 *
 * `description`/`source`/`effects` are inherited from Gear (availability and
 * equip state are meaningless here and stay at their Gear initials).
 */
export class WarrantOption extends Gear {
	static LOCALIZATION_PREFIXES = ["WARRANT_OPTION"];

	declare key: string;
	/** Chart row: warrant-age | fortune-fate | acquisition | sanction | contacts | renown. */
	declare row: string;
	/** Column index on the p34 chart; adjacency uses this. */
	declare col: number;
	/** Machine-applicable mechanics (see rules/warrant.ts WarrantMechanics). */
	declare mechanics: {
		shipPoints: number;
		profitFactor: number;
		notes: string[];
	};

	static override defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			/** Chart key (e.g. "age-of-redemption"); stored in the actor's picks. */
			key: textField(),
			row: textField(),
			col: new fields.NumberField({ min: 0, integer: true, initial: 0 }),
			mechanics: new fields.SchemaField({
				shipPoints: new fields.NumberField({ integer: true, initial: 0 }),
				profitFactor: new fields.NumberField({ integer: true, initial: 0 }),
				notes: new fields.ArrayField(textField(), {
					initial: () => [],
				}),
			}),
		};
	}
}
