import { DamageType } from "./damage-types";
import { Gear } from "./gear";
import { WeaponClass } from "./weapon-class";

/**
 * Placeholder for weapon qualities (e.g. Accurate, Tearing).
 * TODO: flesh out into a proper schema once weapon qualities are modelled.
 */
export interface WeaponQuality {
	name: string;
	rating?: number;
}

/**
 * Common behaviour and data shared by all weapon types (melee, ranged).
 */
export abstract class Weapon extends Gear {
	static LOCALIZATION_PREFIXES = ["WEAPON"];

	declare primitive: boolean;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Weapon class, e.g. pistol/basic/heavy/thrown/melee. */
			class: new foundry.data.fields.StringField({
				choices: Object.values(WeaponClass),
				initial: WeaponClass.Melee as WeaponClass,
				required: true,
				nullable: false,
			}),
			/** Effective range: metres ("90"), formula ("SBx3"), or "—". */
			range: new foundry.data.fields.StringField({
				required: true,
				initial: "—",
			}),
			/** Damage formula, e.g. "1d10+4" (type is a separate field). */
			damage: new foundry.data.fields.StringField({
				required: true,
				initial: "",
			}),
			/** Damage type the formula deals (E/I/R/X in book notation). */
			damageType: new foundry.data.fields.StringField({
				choices: Object.values(DamageType),
				initial: DamageType.Impact,
				required: true,
				nullable: false,
			}),
			penetration: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			/**
			 * Primitive weapon quality (bead xof): gates the primitive-armour
			 * rule (non-primitive weapons double wounds vs primitive armour).
			 * The book expresses it as the Primitive (X) quality; the boolean is
			 * the machine-readable form (the special list containing
			 * "primitive" also satisfies it at resolve time).
			 */
			primitive: new foundry.data.fields.BooleanField({ initial: false }),
			special: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField({
					// Registry keys (QUALITIES seed); no `choices` constraint so
					// parameterised entries like "blast-4" validate. Authoring
					// correctness is enforced by the emit script's mapping table.
					required: true,
					nullable: false,
					initial: "",
				}),
			),
		};
	}
}
