/**
 * Starship Components as Items (bead f5xu, Core Rulebook Chapter VIII
 * Tables 8-3..8-8, book pp201-208). One model for the passive component
 * kinds (essential/supplemental/archeotech/xeno-tech) and one for weapon
 * components (lances and macrobatteries, Table 8-4's combat columns).
 * Table 8-8's availability rule is applied per entry at authoring time
 * (SP-cost based for SP-carrying kinds; fixed for archeotech/xeno-tech).
 */

export class ShipComponent extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["SHIP_COMPONENT"];

	declare category: string;
	declare hullTypes: string;
	declare power: string;
	declare space: number;
	declare sp: string;
	declare special: string;
	declare availability: string;
	declare unique: boolean;
	declare description: string;

	static override defineSchema() {
		return {
			/** "essential" | "supplemental" | "archeotech" | "xenotech" (Tables 8-3/8-5/8-6/8-7). */
			category: new foundry.data.fields.StringField({ initial: "supplemental" }),
			/** Verbatim hull-type list from the table ("All Ships", "Transports, Raiders, Frigates"). */
			hullTypes: new foundry.data.fields.StringField({ initial: "" }),
			/** Power draw; drives are "N Generated", others a plain number (StringField for "35 Generated"). */
			power: new foundry.data.fields.StringField({ initial: "" }),
			space: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Ship Point cost ("-", "+1", "+2", "1".."3") — verbatim table token. */
			sp: new foundry.data.fields.StringField({ initial: "-" }),
			/** Special-rule notes (e.g. "External: ...", named qualities). */
			special: new foundry.data.fields.StringField({ initial: "" }),
			/** Availability per Table 8-8 (book p207), applied at authoring time. */
			availability: new foundry.data.fields.StringField({ initial: "scarce" }),
			/** † marker: may not be selected more than once per vessel (Table 8-5). */
			unique: new foundry.data.fields.BooleanField({ initial: false }),
			description: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}
}

export class ShipWeaponComponent extends ShipComponent {
	static override LOCALIZATION_PREFIXES = ["SHIP_WEAPON_COMPONENT"];

	declare strength: number;
	declare damage: string;
	declare critRating: number;
	declare range: number;
	/**
	 * Weapon capacity slot this weapon occupies (bead om4j, Table 8-4 book
	 * p202): dorsal/prow/port/starboard. Assigned at install on the ship
	 * sheet; broadsides must take port or starboard.
	 */
	declare slot: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Crit Strength (Table 8-4; hits scored by the barrage). */
			strength: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			damage: new foundry.data.fields.StringField({ initial: "" }),
			critRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			range: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			slot: new foundry.data.fields.StringField({
				choices: ["", "dorsal", "prow", "port", "starboard"],
				initial: "",
			}),
		};
	}
}