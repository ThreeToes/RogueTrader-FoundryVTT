import { protectionTypes } from "../../registry";
import { Gear } from "./gear";

export class Armour extends Gear {
	static LOCALIZATION_PREFIXES = ["ARMOUR"];

	declare armourPoints: Record<string, number>;
	declare maxAgility: number | null;
	declare protectionType: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/**
			 * Armour points per body location: `{ head: 3, body: 5, ... }`.
			 * A value of 0 means the location is not covered.
			 */
			armourPoints: new foundry.data.fields.TypedObjectField(
				new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			),
			/** Maximum Agility a wearer benefits from (null = no limit). */
			maxAgility: new foundry.data.fields.NumberField({
				min: 0,
				max: 100,
				integer: true,
				nullable: true,
				initial: null,
			}),
			protectionType: new foundry.data.fields.StringField({
				choices: protectionTypes.choices,
				initial: "non-primitive",
				required: true,
				nullable: false,
			}),
		};
	}

	/** Body locations that are covered (armour points greater than zero). */
	get coveredLocations(): string[] {
		return Object.entries(this.armourPoints ?? {})
			.filter(([, ap]) => ap > 0)
			.map(([location]) => location);
	}

	/** Armour points for a body location (0 when uncovered). */
	armourAt(location: string): number {
		return this.armourPoints[location] ?? 0;
	}
}