/**
 * Starship Components as Items (bead f5xu, Core Rulebook Chapter VIII
 * Tables 8-3..8-8, book pp201-208). One model for the passive component
 * kinds (essential/supplemental/archeotech/xeno-tech) and one for weapon
 * components (lances and macrobatteries, Table 8-4's combat columns).
 * Table 8-8's availability rule is applied per entry at authoring time
 * (SP-cost based for SP-carrying kinds; fixed for archeotech/xeno-tech).
 */
import { textField } from "../fields";
import { sourceField } from "./source";

export class ShipComponent extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["SHIP_COMPONENT"];

	declare category: string;
	/** The book's component-type taxonomy (see defineSchema, bead 9cre). */
	declare componentType: string;
	declare hullTypes: string;
	declare power: string;
	declare space: number;
	declare sp: string;
	declare special: string;
	declare availability: string;
	declare unique: boolean;
	declare description: string;
	/**
	 * Strength — ONE printed column, two readings, so it lives on the base model.
	 *
	 * On a WEAPON component it is the barrage's Crit Strength (Table 8-4,
	 * Core Rulebook p202 — the hits scored by the barrage). On a LANDING BAY it
	 * is the number of attack-craft squadrons the bay supports: battlefleet
	 * koronus Table 1-9: Starship Weapons (printed p35) prints a Strength column
	 * for the Landing Bays rows, and their own text says "Landing bays come
	 * equipped with one squadron per point of Strength". A landing bay has a
	 * Strength but no Damage or Crit Rating, which is why it is not a
	 * ship-weapon-component — declaring the field here is what keeps those five
	 * bays' Strength from being silently dropped (bead r8rx audit).
	 */
	declare strength: number;
	/**
	 * Book + printed page (bead r8rx audit). Every entry in components.yaml and
	 * ships.yaml sets this, but the model never declared it, so Foundry's
	 * schema clean SILENTLY DROPPED it on load — 236 entries lost their
	 * provenance without a single warning anywhere in the pipeline.
	 */
	declare source: { book: string; page: number };
	/**
	 * Condition (book p223: "A ship's Component is either intact, unpowered,
	 * damaged, or destroyed"); depressurisation is a separate condition
	 * (p224). Set by ship combat criticals; Emergency Repairs fixes
	 * unpowered/damaged/depressurised, never destroyed (p218/p224).
	 */
	declare state: string;
	declare depressurised: boolean;

	static override defineSchema() {
		return {
			/** "essential" | "supplemental" | "archeotech" | "xenotech" (Tables 8-3/8-5/8-6/8-7). */
			category: new foundry.data.fields.StringField({ initial: "supplemental" }),
			/** Verbatim hull-type list from the table ("All Ships", "Transports, Raiders, Frigates"). */
			hullTypes: textField(),
			/** Power draw; drives are "N Generated", others a plain number (StringField for "35 Generated"). */
			power: textField(),
			space: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Ship Point cost ("-", "+1", "+2", "1".."3") — verbatim table token. */
			sp: new foundry.data.fields.StringField({ initial: "-" }),
			/** Special-rule notes (e.g. "External: ...", named qualities). */
			special: textField(),
			/** Availability per Table 8-8 (book p207), applied at authoring time. */
			availability: new foundry.data.fields.StringField({ initial: "scarce" }),
			/** † marker: may not be selected more than once per vessel (Table 8-5). */
			unique: new foundry.data.fields.BooleanField({ initial: false }),
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			// Printed Strength column (see the declare above for both readings).
			strength: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			// Book + printed page (bead r8rx audit). Declared late, after an audit
			// found 236 component/ship entries carrying it into a model that
			// dropped it silently.
			source: sourceField(),
			/**
			 * The book's component-type taxonomy (bead 9cre rework): Essential
			 * components carry the category headings of the Essential
			 * Components section (Core Rulebook p200-202 — Plasma Drives,
			 * Warp Engines, Geller Fields, Void Shields, Bridges, Life
			 * Sustainers, Crew Quarters, Augur Arrays; "A ship must have one
			 * (no more) Component from each of the following categories");
			 * weapons carry the Table 8-4 headings (p203 — Macrobatteries,
			 * Lances); everything else carries its table grouping
			 * (supplemental / archeotech / xenotech, Tables 8-5/8-6/8-7).
			 * blank: true — choices force blank:false in core, but pack rows
			 * are backfilled and the value is authoritative.
			 */
			componentType: new foundry.data.fields.StringField({
				choices: [
					"",
					"plasma-drive",
					"warp-engine",
					"geller-field",
					"void-shield",
					"bridge",
					"life-sustainer",
					"crew-quarters",
					"augur-array",
					"macrobattery",
					"lance",
					// BFK/ITS additions (bead 5lbn): the book's own weapon
					// component families beyond batteries and lances.
					"nova-cannon",
					"torpedo-tube",
					"landing-bay",
					"supplemental",
					"archeotech",
					"xenotech",
				],
				initial: "",
				blank: true,
			}),
			// Component condition (bead xfta, book p223-224).
			state: new foundry.data.fields.StringField({
				choices: ["intact", "unpowered", "damaged", "destroyed"],
				initial: "intact",
			}),
			depressurised: new foundry.data.fields.BooleanField({ initial: false }),
		};
	}
}

export class ShipWeaponComponent extends ShipComponent {
	static override LOCALIZATION_PREFIXES = ["SHIP_WEAPON_COMPONENT"];

	declare strength: number;
	/** Variable Strength die ("1d5" for ork Dorsal Gunz, book p209). */
	declare strengthRoll: string;
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
			// `strength` is inherited from ShipComponent — the same printed column,
			// shared with landing bays. See the declare there.
			/** Variable Strength die (gjn6, book p209 dagger note: Dorsal Gunz
			 * roll 1d5 for Strength before firing each turn). Empty = fixed
			 * Strength. */
			strengthRoll: textField(),
			damage: textField(),
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
				// blank: true — StringField FORCES blank:false when choices are
				// set (core source: "If choices are provided, the field should
				// not be null or blank by default"), but the om4j model
				// deliberately starts weapons UNASSIGNED (validateWeaponSlots
				// flags them loudly); the slot is assigned at install.
				choices: ["", "dorsal", "prow", "port", "starboard", "keel"],
				initial: "",
				blank: true,
			}),
		};
	}
}