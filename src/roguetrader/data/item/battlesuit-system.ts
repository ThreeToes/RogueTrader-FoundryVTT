import { battlesuitSystemCategories } from "../../registry";
import { Gear } from "./gear";

/**
 * Tau battlesuit systems (Tau Character Guide printed pp31-38): the Primary,
 * Support, Signature and Weapon Systems a battlesuit can mount.
 *
 * The two structured fields exist because the book's rules turn on them:
 *
 *   - `category` — Table 1-5: Battlesuit Critical Effects (printed p31) names
 *     the category when a hit disables something ("one of the battlesuit's
 *     Weapons or Support Systems", "Support or Signature Systems"), so the
 *     category has to be machine-readable for that table to act on a suit.
 *   - `hardPointCost` — printed p37: "A battlesuit can typically only be
 *     equipped with as many Support Systems and/or Weapons Systems as it has
 *     Hard Points". Primary Systems are integral and cost none (p38); Signature
 *     Systems are not part of the Hard Point sentence at all, so they cost none.
 *
 * Availability defaults follow the same pages: all Support Systems are assumed
 * Extremely Rare (p33) and all Signature Systems Unique (p35) — the emitter
 * stamps those values rather than leaving them to an author to guess.
 */
export class BattlesuitSystem extends Gear {
	static LOCALIZATION_PREFIXES = ["BATTLESUIT_SYSTEM"];

	declare category: string;
	declare hardPointCost: number;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Which of the book's four system sections this entry came from. */
			category: new foundry.data.fields.StringField({
				choices: battlesuitSystemCategories.choices,
				initial: "support",
				required: true,
				nullable: false,
			}),
			/** Hard Points this system consumes (0 = integral / signature). */
			hardPointCost: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 1,
			}),
		};
	}
}
