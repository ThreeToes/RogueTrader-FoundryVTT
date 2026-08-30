/**
 * Vehicle actor data model.
 *
 * Structure-first, mirroring Character conventions: raw data capture only.
 * Derived game rules (cruise speed derivation, SI damage, hit-facing mapping,
 * handling modifiers) belong to the rules layer later - the only derived
 * helpers here are definitional (armourAt).
 *
 * Variation across vehicle families is NOT schema - vehicle classes, armour
 * facings, traits and system slots are EntryRegistry instances
 * (CONFIG.ROGUE_TRADER.vehicle*), so modules extend them at init the same
 * way they extend weapon qualities.
 */

import { vehicleClasses, vehicleFacings, vehicleTraits } from "../../registry";

export class Vehicle extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["VEHICLE"];

	declare structuralIntegrity: { value: number; max: number };
	declare armour: Record<string, number>;
	declare handling: number;
	declare speed: number;
	declare size: string;
	declare vehicleClass: string;
	declare traits: string[];
	declare systems: Record<string, { rating: number; damaged: boolean }>;
declare crew: string[];
	declare mountedWeapons: Array<{ uuid: string; facing: string }>;
	declare description: string;

	static override defineSchema() {
		return {
			/** Structural integrity, mirrors the wounds {value, max} pattern. */
			structuralIntegrity: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				max: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			/**
			 * Armour points per facing: `{ front: 20, left: 15, ... }`. Keys are
			 * `vehicleFacings` registry entries (same shape as
			 * Armour.armourPoints with body locations). 0 = uncovered.
			 */
			armour: new foundry.data.fields.TypedObjectField(
				new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			),
			/** Handling modifier in percentage points (raw capture). */
			handling: new foundry.data.fields.NumberField({
				min: -100,
				max: 100,
				integer: true,
				initial: 0,
			}),
			/** Top speed / movement rating (raw capture, unit-free). */
			speed: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Vehicle size category (free text, e.g. "Enormous"). */
			size: new foundry.data.fields.StringField({ initial: "" }),
			/** Vehicle class, choices from the vehicleClasses registry. */
			vehicleClass: new foundry.data.fields.StringField({
				choices: vehicleClasses.choices,
				initial: "ground",
				required: true,
				nullable: false,
			}),
			/** Vehicle traits, choices from the vehicleTraits registry. */
			traits: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField({
					choices: vehicleTraits.choices,
					nullable: false,
				}),
				{ initial: [] },
			),
			/** Named system slots keyed by the vehicleSystems registry. */
			systems: new foundry.data.fields.TypedObjectField(
				new foundry.data.fields.SchemaField({
					rating: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					damaged: new foundry.data.fields.BooleanField({ initial: false }),
				}),
			),
			/** Crew/passenger Actor UUIDs (reference list, not embedded docs). */
			crew: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField({ initial: "" }),
				{ initial: () => [] },
			),
			/** Mounted weapons: {uuid, facing} references, facing from vehicleFacings. */
			mountedWeapons: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					uuid: new foundry.data.fields.StringField({
						initial: "",
						required: true,
					}),
					facing: new foundry.data.fields.StringField({
						choices: vehicleFacings.choices,
						initial: "front",
						required: true,
						nullable: false,
					}),
				}),
				{ initial: () => [] },
			),
			description: new foundry.data.fields.HTMLField(),
		};
	}

	/** Armour points for a facing (0 when the facing has no armour). */
	armourAt(facing: string): number {
		return this.armour[facing] ?? 0;
	}
}
