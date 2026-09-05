/**
 * Starship hulls as Items (bead sl31, rt_core Chapter VIII p193-196).
 * The hull defines the ship's base characteristics; components are a later
 * pass (bead follow-up). All values verbatim from the hull statlines.
 */
export class Starship extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["STARSHIP"];

	declare hullClass: string;
	declare dimensions: string;
	declare mass: string;
	declare crew: string;
	declare accel: string;
	declare speed: number;
	declare manoeuvrability: number;
	declare detection: number;
	declare hullIntegrity: number;
	declare armour: number;
	declare turretRating: number;
	declare space: number;
	declare sp: number;
	declare weaponCapacity: string;
	declare specialRules: string;
	declare description: string;

	static override defineSchema() {
		return {
			/** Transport / Raider / Frigate / Light Cruiser / Cruiser. */
			hullClass: new foundry.data.fields.StringField({ initial: "transport" }),
			dimensions: new foundry.data.fields.StringField({ initial: "" }),
			mass: new foundry.data.fields.StringField({ initial: "" }),
			crew: new foundry.data.fields.StringField({ initial: "" }),
			accel: new foundry.data.fields.StringField({ initial: "" }),
			speed: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			manoeuvrability: new foundry.data.fields.NumberField({ integer: true, initial: 0 }),
			detection: new foundry.data.fields.NumberField({ integer: true, initial: 0 }),
			hullIntegrity: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			armour: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			turretRating: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			space: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			/** Ship Points (hull cost). */
			sp: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			weaponCapacity: new foundry.data.fields.StringField({ initial: "" }),
			/** Named hull special rules, verbatim ("Cargo Hauler: ..."). */
			specialRules: new foundry.data.fields.HTMLField({ initial: "" }),
			description: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}
}

/**
 * Ship complications (Tables 8-1 / 8-2, pdf p198-199): the captain rolls
 * once on each chart when creating a ship.
 */
export class ShipComplication extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["SHIPCOMPLICATION"];

	declare kind: string;
	declare roll: number;
	declare effect: string;

	static override defineSchema() {
		return {
			/** "machine-spirit-oddity" (Table 8-1) or "past-history" (8-2). */
			kind: new foundry.data.fields.StringField({ initial: "past-history" }),
			/** 1d10 roll on the table. */
			roll: new foundry.data.fields.NumberField({ min: 1, max: 10, integer: true, initial: 1 }),
			effect: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}
}