/**
 * Starship actor (bead kwd, owner decision 2026-09-05: dedicated starship
 * sheet from scratch). The actor holds a snapshot of its hull's statline
 * (copied from the ships compendium pack when the hull is chosen), the two
 * rolled Complications (Tables 8-1/8-2), crew quality (Core Rulebook p193: all
 * ships start Competent; Incompetent grants +5 SP, Crack costs 5 SP,
 * Veteran 15 SP) and free-text notes.
 */
export const CREW_QUALITIES = {
	incompetent: { skill: 20, spDelta: 5 },
	competent: { skill: 30, spDelta: 0 },
	crack: { skill: 40, spDelta: -5 },
	veteran: { skill: 50, spDelta: -15 },
} as const;

export type CrewQuality = keyof typeof CREW_QUALITIES;

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

	static override defineSchema() {
		return {
			hullName: new foundry.data.fields.StringField({ initial: "" }),
			dimensions: new foundry.data.fields.StringField({ initial: "" }),
			mass: new foundry.data.fields.StringField({ initial: "" }),
			crew: new foundry.data.fields.StringField({ initial: "" }),
			accel: new foundry.data.fields.StringField({ initial: "" }),
			speed: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			manoeuvrability: new foundry.data.fields.NumberField({ integer: true, initial: 0 }),
			detection: new foundry.data.fields.NumberField({ integer: true, initial: 0 }),
			hullIntegrity: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
				max: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			}),
			armour: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			turretRating: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			space: new foundry.data.fields.SchemaField({
				total: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
				used: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			}),
			sp: new foundry.data.fields.SchemaField({
				total: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
				spent: new foundry.data.fields.NumberField({ min: 0, integer: true, initial: 0 }),
			}),
			weaponCapacity: new foundry.data.fields.StringField({ initial: "" }),
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
			machineSpiritOddity: new foundry.data.fields.StringField({ initial: "" }),
			pastHistory: new foundry.data.fields.StringField({ initial: "" }),
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
		};
	}

	/** Ship Points remaining for components/upgrades. */
	get spRemaining(): number {
		return Math.max(0, this.sp.total - this.sp.spent);
	}
}

/** Crew quality effects (Core Rulebook p193). Pure + testable. */
export function crewQualityEffects(quality: string): { skill: number; spDelta: number } {
	return CREW_QUALITIES[(quality as CrewQuality) in CREW_QUALITIES ? (quality as CrewQuality) : "competent"];
}