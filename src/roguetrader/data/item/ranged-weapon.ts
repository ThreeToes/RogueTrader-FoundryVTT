import { Weapon } from "./weapon";
import { RANGED_CLASSES, WeaponClass } from "./weapon-class";
/**
 * Ranged weapon: a Weapon with ammunition management.
 *
 * Launchers (epic nlsh, bead 4obp) carry two load-model fields: `acceptsAmmo`
 * names the ordnance kind the launcher accepts ("missile" — the pack's
 * Missile Launcher; "grenade" — the Mezoa/Voss Grenade Launchers), and
 * `loadedAmmoId` is the owned item id currently loaded. Both initial "":
 * compendium launchers ship unloaded (book-faithful — you buy the launcher
 * and its ordnance separately); loading happens in-world through the
 * weapon sheet (drag an accepted item / Load button → picker).
 */
export class RangedWeapon extends Weapon {
	static LOCALIZATION_PREFIXES = ["RANGED_WEAPON", "WEAPON"];

	static override defineSchema() {
		return {
			...super.defineSchema(),
			class: new foundry.data.fields.StringField({
				choices: RANGED_CLASSES,
				initial: WeaponClass.Basic,
				required: true,
				nullable: false,
			}),
			// This schema is the source of truth for the rate of fire; the READ
			// shape is declared once as `RateOfFire` (data/item/rate-of-fire.ts),
			// which the sheets import rather than re-declaring these fields.
			rateOfFire: new foundry.data.fields.SchemaField({
				singleShot: new foundry.data.fields.BooleanField({ initial: true }),
				burst: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
				fullAuto: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
			}),
			clip: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
				required: true,
			}),
			/** Reload time in book notation: "Full", "2 Full", "Half", "—". */
			reload: new foundry.data.fields.StringField({
				required: true,
				initial: "—",
			}),
			/**
			 * Load model (bead 4obp, epic nlsh): the ordnance KIND this launcher
			 * accepts — "missile" filters owned ammunition items whose `ordnance`
			 * block kind is missile; "grenade" filters owned ranged-weapon items
			 * of the thrown family (the launcher-firable grenades, which remain
			 * hand-throwable). Empty = accepts nothing (explicit, homebrew-
			 * friendly: a homebrew launcher declares its own kind).
			 */
			acceptsAmmo: new foundry.data.fields.StringField({
				required: true,
				nullable: false,
				initial: "",
			}),
			/**
			 * The owned item id currently loaded (bead 4obp Option A). Resolved
			 * against the OWNING actor's items at attack-profile time; empty =
			 * unloaded, and the damage path warns and refuses (no prompt
			 * fallback). No auto-consumption — usage is tracked manually via the
			 * damage card's usage chip (deferred bead mrl4 owns any toggle).
			 */
			loadedAmmoId: new foundry.data.fields.StringField({
				required: true,
				nullable: false,
				initial: "",
			}),
		};
	}
}
