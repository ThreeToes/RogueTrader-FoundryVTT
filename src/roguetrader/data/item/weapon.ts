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
	/** Hard Points this weapon consumes on a battlesuit (0 = not one). */
	declare hardPointCost: number;

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
			/**
			 * Weapon family (bead erzk): the book's Weapon Training talent
			 * group (Las, SP, Bolt, Melta, Plasma, Flame, Launcher, Primitive,
			 * Chain, Power, Shock, Exotic, Thrown — registry keys). This is what
			 * the Weapon Training gate resolves (Core Rulebook printed p272:
			 * "he must have a corresponding Weapon Training Talent"). No
			 * `choices` constraint so blank initial and in-flight authoring
			 * validate; pack completeness is enforced by the pack tests + the
			 * emit mapping's loud failures.
			 */
			weaponFamily: new foundry.data.fields.StringField({ initial: "" }),
			/**
			 * Hard Points consumed when mounted on a Tau battlesuit (bead 61rb).
			 * Tau Character Guide printed p30: "A battlesuit can typically only be
			 * equipped with as many Support Systems and/or Weapons Systems as it
			 * has Hard Points" — so a Weapon System costs 1, exactly like a Support
			 * System, and there is no separate twin-linked discount in the book.
			 *
			 * Initial 0, which is the correct value for every weapon that is not a
			 * battlesuit Weapon System — that is almost all of them — so the field
			 * costs the rest of the armoury nothing. It lives on the shared Weapon
			 * base rather than on the Tau entries so a suit's loadout can total it
			 * without knowing which book a weapon came from.
			 */
			hardPointCost: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
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
