import { Armour } from "./armour";

/**
 * Tau battlesuits (Tau Character Guide Ch II).
 *
 * A battlesuit IS a suit of worn armour — p31, "NANOCRYSTALLINE ARMOUR":
 * "A battlesuit behaves as a suit of worn armour in all ways, and also provides
 * a number of other benefits" — so this extends Armour and adds only what the
 * book's profile block (printed p38) carries beyond it:
 *
 *   Armour Points       -> armourPoints      (inherited; same meaning as core armour)
 *   Hard Points         -> hardPoints        (spent on Support and Weapon Systems)
 *   Size                -> size              (the Size Trait applied to the wearer)
 *   Strength            -> strength          (the battlesuit's Strength Characteristic)
 *   Primary Systems     -> primarySystems    (integral: do NOT count against Hard Points)
 *   Recommended Loadout -> recommendedLoadout
 *   Availability        -> availability      (inherited from Gear)
 *   Special Rules       -> specialRules      (per-chassis prose, e.g. XV25 stealth)
 *
 * Rules the profile format states, kept here so the schema is not guessed at:
 *   - "A battlesuit can typically only be equipped with as many Support Systems
 *     and/or Weapons Systems as it has Hard Points" (p37).
 *   - "These systems are integral and do not count against the Hard Points of
 *     the battlesuit" (p38, of Primary Systems).
 *   - all Support Systems are assumed Extremely Rare (p33) and all Signature
 *     Systems Unique (p35) for Acquisition.
 *
 * Support/Signature Systems are not their own Item type yet: they are the
 * Hard-Point spend `recommendedLoadout` describes (bead rojm tracks them).
 */
export class Battlesuit extends Armour {
	static LOCALIZATION_PREFIXES = ["BATTLESUIT"];

	declare hardPoints: number;
	declare size: string;
	declare strength: number;
	declare primarySystems: string[];
	declare recommendedLoadout: string[];
	declare specialRules: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Hard Points available for Support and Weapon Systems (p38). */
			hardPoints: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/**
			 * The Size Trait applied to the WEARER (p38, "Size: The Size Trait
			 * applied to the wearer of the battlesuit"), not the suit's own.
			 */
			size: new foundry.data.fields.StringField({ initial: "" }),
			/** The battlesuit's Strength Characteristic (p38). */
			strength: new foundry.data.fields.NumberField({
				min: 0,
				max: 100,
				integer: true,
				initial: 0,
			}),
			/** Integral Primary Systems (p31) — free of Hard Point cost. */
			primarySystems: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			/** Common Support/Weapon System selections for this chassis (p38). */
			recommendedLoadout: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			/** Chassis-specific Special Rules prose (profiles, pp39-42). */
			specialRules: new foundry.data.fields.StringField({ initial: "" }),
		};
	}
}
