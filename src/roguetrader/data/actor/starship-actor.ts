/**
 * Starship actor (bead kwd, owner decision 2026-09-05: dedicated starship
 * sheet from scratch). The actor holds a snapshot of its hull's statline
 * (copied from the ships compendium pack when the hull is chosen), the two
 * rolled Complications (Tables 8-1/8-2), crew quality (Core Rulebook p193: all
 * ships start Competent; Incompetent grants +5 SP, Crack costs 5 SP,
 * Veteran 15 SP) and free-text notes.
 */
import { textField } from "../fields";
// Crew-quality table moved to rules/ship-crew.ts (bead xfta) so the roll
// handlers can use it without loading this foundry-extended DataModel.
import {
	CREW_QUALITIES,
	type CrewQuality,
	crewQualityEffects,
} from "../../rules/ship-crew";
import { sourceField } from "../item/source";
import {
	SHIP_TURN_FLAG_KEYS,
	SHIP_TURN_FLAG_TARGET_ALL,
} from "../../../rules-engine/index";
import type {
	ShipBoardingState,
	ShipCrewLosses,
	ShipTorpedoSalvo,
	ShipTurnFlag,
} from "../../../rules-engine/index";

export { CREW_QUALITIES, type CrewQuality, crewQualityEffects };

export class StarshipActor extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["STARSHIP"];

	declare hullName: string;
	declare hullClass: string;
	declare dimensions: string;
	declare mass: string;
	declare crew: string;
	declare accel: string;
	declare speed: number;
	declare manoeuvrability: number;
	declare detection: number;
	declare hullIntegrity: { value: number; max: number };
	declare armour: number;
	declare turretRating: number;
	declare space: { total: number; used: number };
	declare sp: { total: number; spent: number };
	declare weaponCapacity: string;
	/**
	 * Void shields (bead om4j, Table 8-3 book p201): granted by the Single (1)
	 * / Multiple (2) Void Shield Array components; `value` is the absorbable
	 * remaining count, max is derived from installed arrays at render time.
	 */
	declare voidShields: number;
	/**
	 * Crew population + morale percentage tracks (book p224; p221 Hull
	 * Integrity damage also wounds Crew/Morale; Morale gates rout/surrender
	 * via opposed Command).
	 */
	declare crewPopulation: number;
	declare crewMorale: number;
	declare crewQuality: string;
	declare machineSpiritOddity: string;
	declare pastHistory: string;
	declare notes: string;
	/**
	 * Combat turn state (bead vph0, Core Rulebook pp215-218): turn-scoped
	 * modifier flags, the boarding pair, augury-revealed components, Silent
	 * Running and the one-turn crew-loss memory. Pure derivations live in
	 * rules-engine/ship-turn-state.ts.
	 */
	declare turnFlags: ShipTurnFlag[];
	declare boardedWith: ShipBoardingState;
	/**
	 * Active torpedo salvos (epic necp child S9, bead a413; Battlefleet
	 * Koronus printed pp6-7): one record per live salvo, the matching
	 * "torpedo-run" turn flag (same id) carries the S2 expiry countdown;
	 * rules-engine/ship-ordnance.ts owns the maths.
	 */
	declare torpedoSalvos: ShipTorpedoSalvo[];
	declare revealedComponents: string[];
	declare silentRunning: boolean;
	declare lastTurnLosses: ShipCrewLosses;
	/**
	 * The crew tracks as they stood at the start of the turn now closing (bead
	 * 6ddz): the snapshot rules-engine/ship-turn-state.ts's shipTurnStart reads
	 * to compute the losses that rotate into lastTurnLosses at the ship's own
	 * Strategic Turn end. null = no snapshot observed yet.
	 */
	declare turnStartCrew: ShipCrewLosses | null;

	static override defineSchema() {
		return {
			hullName: textField(),
			/**
			 * Hull class (transport / raider / frigate / ...). Declared as a TS
			 * field since the model was written but NEVER added to the schema
			 * (bead r8rx audit), so Foundry dropped it on load while the ship sheet
			 * happily read `system.hullClass` and always got undefined.
			 */
			hullClass: textField(),
			// Book + printed page (bead r8rx audit): starships.yaml sets this on
			// every entry and the schema discarded it.
			source: sourceField(),
			dimensions: textField(),
			mass: textField(),
			crew: textField(),
			accel: textField(),
			speed: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			manoeuvrability: new foundry.data.fields.NumberField({
				integer: true,
				initial: 0,
			}),
			detection: new foundry.data.fields.NumberField({
				integer: true,
				initial: 0,
			}),
			hullIntegrity: new foundry.data.fields.SchemaField({
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
			armour: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			turretRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			space: new foundry.data.fields.SchemaField({
				total: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				used: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			sp: new foundry.data.fields.SchemaField({
				total: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				spent: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			weaponCapacity: textField(),
			/** Void shields remaining (bead om4j, Table 8-3 book p201). */
			voidShields: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Crew population percentage (book p224). */
			crewPopulation: new foundry.data.fields.NumberField({
				min: 0,
				max: 100,
				integer: true,
				initial: 100,
			}),
			/** Crew morale percentage (book p224; p221 rout/surrender gate). */
			crewMorale: new foundry.data.fields.NumberField({
				min: 0,
				max: 100,
				integer: true,
				initial: 100,
			}),
			crewQuality: new foundry.data.fields.StringField({
				choices: Object.keys(CREW_QUALITIES),
				initial: "competent",
			}),
			machineSpiritOddity: textField(),
			pastHistory: textField(),
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
			/**
			 * Turn-scoped modifier flags (bead vph0, decision 3): the salvo and
			 * manoeuvre pipelines read them as visible modifier rows; expiry at
			 * the flagged ship's next Strategic Turn is rules-engine/
			 * ship-turn-state.ts's expireTurnFlags.
			 */
			turnFlags: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					id: new foundry.data.fields.StringField({
						required: true,
						initial: "",
					}),
					key: new foundry.data.fields.StringField({
						required: true,
						nullable: false,
						choices: Object.fromEntries(
							SHIP_TURN_FLAG_KEYS.map((key) => [key, key]),
						),
						initial: "evasive",
					}),
					/** Signed BS/Command modifier (e.g. evasive −10). */
					value: new foundry.data.fields.NumberField({
						integer: true,
						initial: 0,
					}),
					/** Named weapon component item id, or "all". */
					target: new foundry.data.fields.StringField({
						initial: SHIP_TURN_FLAG_TARGET_ALL,
					}),
					/** Recorded expiry turn; null = cleared at next own turn. */
					expiresAtTurn: new foundry.data.fields.NumberField({
						integer: true,
						nullable: true,
						initial: null,
					}),
					/** PERSISTENT (Repel Boarders!, Core Rulebook p218). */
					persistent: new foundry.data.fields.BooleanField({
						initial: false,
					}),
				}),
				{ initial: () => [] },
			),
			/**
			 * Boarding pair (bead vph0, Core Rulebook p215): BOTH ships hold the
			 * pair; a set uuid locks both against Manoeuvre and Shooting Actions
			 * (extended actions stay legal).
			 */
			boardedWith: new foundry.data.fields.SchemaField({
				uuid: new foundry.data.fields.StringField({ initial: "" }),
				/** −20 on the subsequent opposed Command after a failed break-free. */
				breakFreeFailedThisTurn: new foundry.data.fields.BooleanField({
					initial: false,
				}),
			}),
			/**
			 * Component item ids another ship's auguries have revealed (bead vph0,
			 * decision 11): gates the critical-component prompt.
			 */
			revealedComponents: new foundry.data.fields.ArrayField(textField(), {
				initial: () => [],
			}),
			/** Silent Running (bead vph0, decision 8, book p218): broken by firing. */
			silentRunning: new foundry.data.fields.BooleanField({ initial: false }),
			/**
			 * Active torpedo salvos (bead a413; Battlefleet Koronus printed
			 * pp6-7): ship-side ordnance sequence state written by the
			 * Launch Torpedoes / Torpedo Run machinery rows; each entry pairs
			 * with a "torpedo-run" turn flag of the same id.
			 */
			torpedoSalvos: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					id: new foundry.data.fields.StringField({
						required: true,
						initial: "",
					}),
					warhead: textField(),
					name: textField(),
					guidance: textField(),
					damage: textField(),
					critRating: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					terminalPenetration: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					torRating: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					speed: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					range: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					remaining: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					travelled: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					launchTurn: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					wide: new foundry.data.fields.BooleanField({ initial: false }),
					tubeId: textField(),
				}),
				{ initial: () => [] },
			),
			/**
			 * One-turn memory of the PREVIOUS turn's crew losses (bead vph0, book
			 * pp217-218), rewritten at the start of the ship's Strategic Turn;
			 * consumed by Triage (population) and Hold Fast! (morale).
			 */
			lastTurnLosses: new foundry.data.fields.SchemaField({
				population: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				morale: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			/**
			 * Turn-start crew snapshot (bead 6ddz): feeds shipTurnStart's
			 * sustainedCrewLosses rotation — nullable until the ship's first observed
			 * turn start seeds it.
			 */
			turnStartCrew: new foundry.data.fields.SchemaField({
				population: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					nullable: true,
					initial: null,
				}),
				morale: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					nullable: true,
					initial: null,
				}),
			}),
		};
	}

	/** Ship Points remaining for components/upgrades. */
	get spRemaining(): number {
		return Math.max(0, this.sp.total - this.sp.spent);
	}
}
