import { Gear } from "./gear";

/**
 * Ammunition: consumable rounds for weapons (extends Gear's trade fields).
 *
 * Quantity (bead 1sxq) is inherited from the Gear base — Ammunition used to
 * declare its own `quantity` (integer, min 0, initial 0); folding it into the
 * base deliberately changes the un-authored initial from 0 to 1 (an item
 * exists at quantity 1, 0 = spent), per the owner decision on the shared Gear
 * quantity field (2026-10-02). min 0 / integer / required are unchanged.
 */

/**
 * Structured ordnance block (bead 4obp, epic nlsh): the fire profile of
 * LAUNCHER ordnance. Book fields NOT carried: Range/RoF/Class print "—" for
 * missiles (Table 5-6) because the launcher's own range/RoF/class cover the
 * ammo; weight/availability stay on the Gear base as usual. An absent/blank
 * block means "plain ammunition" — the ~40 descriptive entries in the gear
 * pack have none, and the launcher load-model only accepts ammunition WITH
 * one (loud, never a silent empty profile).
 */
export interface Ordnance {
	/**
	 * Ordnance kind(s) the launcher's `acceptsAmmo` resolves against ("missile").
	 * Normally ONE kind; a round whose book reading is ambiguous may author a
	 * WHITESPACE-SEPARATED LIST ("grenade missile") — the load gate is
	 * membership (attack.ts ordnanceKindsOf/acceptsOrdnance, bead mnrm), so a
	 * two-kind round loads into any launcher naming one of its kinds. Single-
	 * kind strings remain the normal shape and are unchanged in behaviour.
	 */
	kind: string;
	/** Damage formula in RT notation (type-suffix stripped, e.g. "2d10"). */
	damage: string;
	/** DamageType value ("Explosive" in the pack). */
	damageType: string;
	penetration: number;
	/** Weapon qualities as registry keys (e.g. ["blast-6"]). */
	qualities: string[];
}

export class Ammunition extends Gear {
	static LOCALIZATION_PREFIXES = ["AMMUNITION"];

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/**
			 * Launcher-ordnance block (bead 4obp): present ONLY on ammunition
			 * that is real attack ordnance (the pack's Frag/Krak Missile). The
			 * launcher's attack profile derives damage/type/penetration/qualities
			 * from this block when the item is loaded (ffg/domain/model/attack.ts,
			 * ordnanceFieldsOf). quantity stays the manual usage count (1sxq).
			 */
			ordnance: new foundry.data.fields.SchemaField({
				/**
				 * The ordnance KIND(S) (bead pht2/mnrm). A single kind stands as
				 * before ("missile"); a whitespace-separated list ("grenade
				 * missile") declares a round that satisfies MULTIPLE launchers
				 * (Starflare Round, Into the Storm p116-117 — owner ruling
				 * 2026-10-04: both readings permitted). Kept a StringField, NOT an
				 * ArrayField: a Foundry ArrayField cannot hydrate a legacy string
				 * source (single-kind authoring would break), and there is no hard
				 * enum to validate entries against — `acceptsAmmo` is intentionally
				 * homebrew-open, so kinds stay open with the ORDNANCE_KINDS registry
				 * (attack.ts) as the documented vocabulary only.
				 */
				kind: new foundry.data.fields.StringField({
					required: true,
					nullable: false,
					initial: "",
				}),
				damage: new foundry.data.fields.StringField({
					required: true,
					nullable: false,
					initial: "",
				}),
				damageType: new foundry.data.fields.StringField({
					required: true,
					nullable: false,
					initial: "",
				}),
				penetration: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
					required: true,
				}),
				qualities: new foundry.data.fields.ArrayField(
					new foundry.data.fields.StringField({ required: true }),
					{ initial: () => [] },
				),
			}),
		};
	}
}
