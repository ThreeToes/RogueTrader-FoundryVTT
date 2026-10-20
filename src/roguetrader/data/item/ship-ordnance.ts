import { textField } from "../fields";
import { sourceField } from "./source";
import { Gear } from "./gear";

/**
 * Ship ordnance (epic necp child S9, bead a413 — Battlefleet Koronus ch. I
 * "The Weapons of War"): torpedo warheads, torpedo guidance systems and
 * attack-craft types as Items. A dedicated `ship-ordnance` Item type — the
 * book prints a THRID stat shape (Speed/Damage/Crit Rating/Range +
 * Terminal Penetration + Torpedo Rating; Table 1-3's Craft Rating/Speed/
 * Squadron Size) that neither the ship-component nor the gear schema
 * carries, and Foundry's TypeDataModel would silently drop any of these
 * fields authored on gear (the pack-schema guard precedent).
 *
 * The machine keys (`ordKey`) match rules-engine/ship-ordnance.ts's printed
 * tables (Table 1-1, guidance, Table 1-3) — the pack guard test pins every
 * entry's ordKey to the kernel table.
 *
 * Schema follows the printed stat columns:
 * - WARBHEAD/GUIDANCE entries (`kind: "torpedo"` / "torpedo-guidance"):
 *   speed (VU/turn), damage (per-hit formula), critRating (damage-DIE
 *   threshold, 0 = printed "–"), range (VU), terminalPenetration (X,
 *   0 = none), torpedoRating (the printed guidance contribution, p9).
 * - ATTACK-CRAFT entries (`kind: "attack-craft"`): craftRating, speed,
 *   squadronSize, altCraftRating (Multi-purpose parenthetical), sortieTurns
 *   (the printed 4/6-turn stay-away limits, pp12-13).
 * - `special` is the terse printed Special-Rules column; `description` the
 *   full prose (both flavours convention).
 * - `quantity` (inherited from the Gear base, the 1sxq stack-count owner
 *   decision): the SHIP's owned copies record its stores — the Launch
 *   Torpedoes row decrements through ordnance.ts's single decrementQuantity
 *   helper (never an ad-hoc decrement); pack reference copies ship at the
 *   schema default of 1.
 */
export class ShipOrdnance extends Gear {
	static LOCALIZATION_PREFIXES = ["SHIP_ORDNANCE"];

	declare kind: string;
	/** Machine key into the kernel's printed tables. */
	declare ordKey: string;
	declare craftRating: number;
	declare altCraftRating: number;
	declare squadronSize: number;
	/** Strategic Turns the squadron may stay away (printed 4/6). */
	declare sortieTurns: number;
	declare torpedoRating: number;
	declare speed: number;
	declare damage: string;
	declare critRating: number;
	declare range: number;
	declare terminalPenetration: number;
	declare special: string;
	declare description: string;

	static override defineSchema() {		return {
			...super.defineSchema(),
			/** "torpedo" | "torpedo-guidance" | "attack-craft". */
			kind: new foundry.data.fields.StringField({
				choices: ["torpedo", "torpedo-guidance", "attack-craft"],
				initial: "torpedo",
			}),
			/** Machine key ("plasma", "guided", "fury-interceptor", ...). */
			ordKey: textField(),
			// Availability rides the inherited Gear field (Table 1-2/craft
			// values normalize through the shared availability ladder).
			// --- attack-craft columns (Table 1-3, printed p14) -----------------
			/** Craft Rating bonus (printed "Craft Rating" column). */
			craftRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Multi-purpose second reading ("+8 (+4)" → 4, printed p14). */
			altCraftRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Craft per full squadron (Table 1-3 "Squadron Size"). */
			squadronSize: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Stay-away limit in Strategic Turns (printed pp12-13: 4 or 6). */
			sortieTurns: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			// --- torpedo columns (Table 1-1, printed p8 + guidance p9) ---------
			/** Torpedo Rating contribution (guidance prose, printed p9). */
			torpedoRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Speed in VU per Strategic Turn. */
			speed: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Per-hit damage formula ("2d10+14"). */
			damage: textField(),
			/** Damage-DIE critical threshold (0 = the printed "–"). */
			critRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Total flight range in VUs. */
			range: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Terminal Penetration (X): damage dice ≤ X re-rolled once. */
			terminalPenetration: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** The terse printed Special-Rules / Special column. */
			special: textField(),
			// description + quantity ride the inherited Gear fields.
			/** Book + printed page (extraction conventions). */
			source: sourceField(),
		};
	}
}