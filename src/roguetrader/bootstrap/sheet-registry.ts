/**
 * The document-type registry (bead 6a1x; epic kof0, phase 5).
 *
 * Declarative data only: one entry per document type = { model, sheet, label }.
 * bootstrap/sheets.ts turns this table into CONFIG.*.dataModels plus
 * DocumentSheetConfig registrations. Adding a type is one line here.
 *
 * A type with no `sheet` registers its data model only (raw document types:
 * starship hull/complications/components, legacy "pc").
 */

import { Character } from "../data/actor/character";
import { Dynasty } from "../data/actor/dynasty";
import { PlanetActor } from "../data/actor/planet-actor";
import { StarshipActor } from "../data/actor/starship-actor";
import { Vehicle } from "../data/actor/vehicle";
import { Ammunition } from "../data/item/ammunition";
import { Armour } from "../data/item/armour";
import { ArmourModification } from "../data/item/armour-modification";
import { Battlesuit } from "../data/item/battlesuit";
import { BattlesuitSystem } from "../data/item/battlesuit-system";
import { Career } from "../data/item/career";
import { ForceField } from "../data/item/force-field";
import { GameTable } from "../data/item/game-table";
import { Gear } from "../data/item/gear";
import { Heirloom } from "../data/item/heirloom";
import { MadnessEntry } from "../data/item/madness";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { Mutation } from "../data/item/mutation";
import { NavigatorPower } from "../data/item/navigator-power";
import { Origin } from "../data/item/origin";
import { OriginTrait } from "../data/item/origin-trait";
import { PsychicPower } from "../data/item/psychic-power";
import { RangedWeapon } from "../data/item/ranged-weapon";
import {
	ShipComponent,
	ShipWeaponComponent,
} from "../data/item/ship-component";
import { ShipComplication, Starship } from "../data/item/starship";
import { Skill } from "../data/item/skill";
import { Talent } from "../data/item/talent";
import { Trait } from "../data/item/trait";
import { WarrantOption } from "../data/item/warrant-option";
import { WeaponModification } from "../data/item/weapon-modification";
import { CharacterSheet } from "../sheet/actor/character-sheet";
import { DynastySheet } from "../sheet/actor/dynasty-sheet";
import { NpcSheet } from "../sheet/actor/npc-sheet";
import { PlanetSheet } from "../sheet/actor/planet-sheet";
import { ShipSheet } from "../sheet/actor/ship-sheet";
import { VehicleSheet } from "../sheet/actor/vehicle-sheet";
import { ArmourSheet } from "../sheet/item/armour-sheet";
import { CareerSheet } from "../sheet/item/career-sheet";
import { GameTableSheet } from "../sheet/item/game-table-sheet";
import { GearSheet } from "../sheet/item/gear-sheet";
import { NavigatorPowerSheet } from "../sheet/item/navigator-power-sheet";
import { PsychicPowerSheet } from "../sheet/item/psychic-power-sheet";
import { ShipComponentSheet } from "../sheet/item/ship-component-sheet";
import { ShipComplicationSheet } from "../sheet/item/ship-complication-sheet";
import { ShipHullSheet } from "../sheet/item/ship-hull-sheet";
import { SkillSheet } from "../sheet/item/skill-sheet";
import { TalentSheet } from "../sheet/item/talent-sheet";
import { TraitSheet } from "../sheet/item/trait-sheet";
import { WeaponSheet } from "../sheet/item/weapon-sheet";

// 6a1x: any sheet constructor. never[] params (not unknown[]) so concrete
// ApplicationV2 constructors with specific optional options objects are
// assignable without per-call casts (never is assignable to everything).
export type AnySheetCtor = new (...args: never[]) => object;

export type SheetEntry = {
	model: unknown;
	sheet?: AnySheetCtor;
	label?: string;
};

/**
 * Plain-Gear reuse (beads r7w, 5p8): compendium-sourced aptitudes and the
 * plain-Gear subtypes have no extra schema (all Gear fields have initials) and
 * reuse the Gear model + generic sheet so opening them does not crash
 * DocumentSheetConfig. (Pre-table these types were registered twice with
 * different labels; DocumentSheetConfig keys registrations by scope + sheet
 * class, so the later ROGUE_TRADER.GEAR.SHEET label won — the table keeps that
 * final state.)
 */
export const SHEET_REGISTRY: Record<
	"Item" | "Actor",
	Record<string, SheetEntry>
> = {
	Item: {
		gear: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
		"ranged-weapon": {
			model: RangedWeapon,
			sheet: WeaponSheet,
			label: "ROGUE_TRADER.WEAPON.SHEET",
		},
		"melee-weapon": {
			model: MeleeWeapon,
			sheet: WeaponSheet,
			label: "ROGUE_TRADER.WEAPON.SHEET",
		},
		armour: {
			model: Armour,
			sheet: ArmourSheet,
			label: "ROGUE_TRADER.ARMOUR.SHEET",
		},
		// Tau battlesuits (bead rojm): worn armour plus Hard Points, Size,
		// Strength, Primary Systems and a recommended loadout — the Tau
		// Character Guide profile block (printed p38). Rendered by the armour
		// sheet, which adds the battlesuit section for this type.
		battlesuit: {
			model: Battlesuit,
			sheet: ArmourSheet,
			label: "TYPES.Item.battlesuit",
		},
		// Tau battlesuit systems (bead i0dc): Primary/Support/Signature/Weapon
		// Systems, with the category Table 1-5 names and the Hard Point cost
		// the suit's budget is spent on.
		"battlesuit-system": {
			model: BattlesuitSystem,
			sheet: GearSheet,
			label: "TYPES.Item.battlesuit-system",
		},
		skill: {
			model: Skill,
			sheet: SkillSheet,
			label: "ROGUE_TRADER.SKILL.SHEET",
		},
		talent: {
			model: Talent,
			sheet: TalentSheet,
			label: "ROGUE_TRADER.TALENT.SHEET",
		},
		career: { model: Career, sheet: CareerSheet, label: "TYPES.Item.career" },
		// Starship hulls (bead 5lbn follow-up): dedicated hull sheet (the
		// statline + pre-installed component lists; the ship creator
		// instantiates those by name with loud failures).
		ship: { model: Starship, sheet: ShipHullSheet, label: "TYPES.Item.ship" },
		"ship-complication": {
			model: ShipComplication,
			sheet: ShipComplicationSheet,
			label: "TYPES.Item.ship-complication",
		},
		"ship-component": {
			model: ShipComponent,
			sheet: ShipComponentSheet,
			label: "TYPES.Item.ship-component",
		},
		"ship-weapon-component": {
			model: ShipWeaponComponent,
			sheet: ShipComponentSheet,
			label: "TYPES.Item.ship-weapon-component",
		},
		// Game reference tables (planet/system generation rows):
		// dedicated type so they are not plain Gear; attach to planet
		// actors as embedded documents.
		"game-table": {
			model: GameTable,
			sheet: GameTableSheet,
			label: "TYPES.Item.game-table",
		},
		// Compendium-sourced aptitudes are description-only items; reuse
		// the Gear model (all fields have initials) and its generic sheet
		// (bead r7w).
		aptitude: {
			model: Gear,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		psychicpower: {
			model: PsychicPower,
			sheet: PsychicPowerSheet,
			label: "TYPES.Item.psychicpower",
		},
		// Navigator powers (bead sa6, Ch. VII): distinct type, no Focus
		// Power Test / Psy Rating / phenomena (book p178).
		navigatorpower: {
			model: NavigatorPower,
			sheet: NavigatorPowerSheet,
			label: "TYPES.Item.navigatorpower",
		},
		// Origin traits, mutations, madness, ammunition, force fields and
		// weapon modifications reuse the Gear model + generic sheet.
		origintrait: {
			model: OriginTrait,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		// Origin Path chart entries (epic 1gb7; moved out of rules/origins.ts).
		origin: { model: Origin, sheet: GearSheet, label: "TYPES.Item.origin" },
		"warrant-option": {
			model: WarrantOption,
			sheet: GearSheet,
			label: "TYPES.Item.warrant-option",
		},
		// Heirloom grant templates (Table 1-2, epic 1gb7 follow-up).
		heirloom: {
			model: Heirloom,
			sheet: GearSheet,
			label: "TYPES.Item.heirloom",
		},
		mutation: {
			model: Mutation,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		madnessentry: {
			model: MadnessEntry,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		// Rulebook traits (bead 25ii): innate creature features. Always
		// live in effectsAreLive (no equip state); mechanical traits feed
		// the funnel via their effect rows (bead zyv1).
		trait: { model: Trait, sheet: TraitSheet, label: "TYPES.Item.trait" },
		ammunition: {
			model: Ammunition,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		"force-field": {
			model: ForceField,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		"weapon-modification": {
			model: WeaponModification,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		// Armour upgrades (bead dfb8, Hostile Acquisitions Table 2-17):
		// mirrors weapon-modification — Gear model + `upgrades` string.
		"armour-modification": {
			model: ArmourModification,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
		// No extra schema needed: reuse the Gear model for the plain-Gear
		// subtypes the packs reference (bead 5p8 scope note).
		tool: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
		drug: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
		"special-ability": {
			model: Gear,
			sheet: GearSheet,
			label: "ROGUE_TRADER.GEAR.SHEET",
		},
	},
	Actor: {
		// Legacy "pc": model kept until the ready-migration has run, no
		// sheet registration (bead ow8w deletes it post-migration).
		pc: { model: Character },
		// "explorer" = the character type (owner: rename of the legacy
		// DH2 "acolyte" and the creator-made "pc"); pc is migrated at
		// ready (ow8w) but keeps its dataModel until the migration has run.
		explorer: {
			model: Character,
			sheet: CharacterSheet,
			label: "ROGUE_TRADER.CHARACTER.SHEET",
		},
		npc: { model: Character, sheet: NpcSheet, label: "NPC.SHEET" },
		vehicle: {
			model: Vehicle,
			sheet: VehicleSheet,
			label: "ROGUE_TRADER.VEHICLE.SHEET",
		},
		// Group record for Profit Factor / Ship Points (bead gjvg).
		dynasty: { model: Dynasty, sheet: DynastySheet, label: "DYNASTY.SHEET" },
		// Starship actor (bead kwd): dedicated starship sheet.
		starship: {
			model: StarshipActor,
			sheet: ShipSheet,
			label: "STARSHIP.SHEET",
		},
		// Planet actor (owner ask, planet tables): SOI world record.
		planet: {
			model: PlanetActor,
			sheet: PlanetSheet,
			label: "TYPES.Actor.planet",
		},
	},
};
