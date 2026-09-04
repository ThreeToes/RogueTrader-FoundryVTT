/**
 * Careers as Items (content-as-data, mirroring Talent/Skill): actors pick a
 * career; the catalog lives in registries (CONFIG.ROGUE_TRADER.careers) and
 * the compendium pack delivers the core-8. Splat books register additional
 * careers (incl. alternate career ranks) at init — careers are content, not
 * code (bead 2n5).
 *
 * All book data is stored verbatim/structured per the extraction conventions:
 * prerequisite strings stay raw (structured parsing arrives with the
 * soft-enforcement layer, cf. tfk), and rank XP thresholds are stored
 * per-rank (owner option a) so splat books can vary them.
 */
export class Career extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["CAREER"];

	declare key: string;
	declare shortDescription: string;
	declare description: string;
	declare source: { book: string; page: number };
	declare aptitudes: string[];
	declare characteristicAdvances: Record<
		string,
		{ simple: number; intermediate: number; trained: number; expert: number }
	>;
	declare startingSkills: string[];
	declare startingTalents: string[];
	declare startingGear: string[];
	declare ranks: CareerRank[];

	static override defineSchema() {
		return {
			/** Stable slug ("rogue-trader"); the registry key for the career. */
			key: new foundry.data.fields.StringField({
				initial: "",
				required: true,
				nullable: false,
			}),
			/** Terse line from Table 2-1 (verbatim book text). */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Long prose description (career section, HTML for prose-mirror). */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			/** Citation: which book/page this career (or alt-rank set) came from. */
			source: new foundry.data.fields.SchemaField({
				book: new foundry.data.fields.StringField({ initial: "rt_core" }),
				page: new foundry.data.fields.NumberField({
					integer: true,
					min: 0,
					initial: 0,
				}),
			}),
			/** Keys into the aptitudes registry (the career's 2 aptitudes). */
			aptitudes: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			/**
			 * Characteristic Advance Scheme: per-characteristic XP costs for the
			 * four book progression levels (Simple/Intermediate/Trained/Expert).
			 * Pure display data until an advancement engine exists.
			 */
			characteristicAdvances: new foundry.data.fields.TypedObjectField(
				new foundry.data.fields.SchemaField({
					simple: new foundry.data.fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
					intermediate: new foundry.data.fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
					trained: new foundry.data.fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
					expert: new foundry.data.fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
				}),
				{ initial: () => ({}) },
			),
			/** Starting kit: keys into the skills/talents packs. */
			startingSkills: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			startingTalents: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			/** Free-text starting gear until a gear pack exists (bead sgq). */
			startingGear: new foundry.data.fields.ArrayField(
				new foundry.data.fields.StringField(),
				{ initial: () => [] },
			),
			/**
			 * Rank 1-8 advance tables. xpLevel is the total-spent-XP threshold
			 * from Table 2-2, stored per-rank (owner decision: option a) so
			 * splat books can extend or alter progression without code.
			 */
			ranks: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					rank: new foundry.data.fields.NumberField({
						integer: true,
						min: 1,
						required: true,
						nullable: false,
					}),
					xpLevel: new foundry.data.fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
					advances: new foundry.data.fields.ArrayField(
						new foundry.data.fields.SchemaField({
							/** Key into the skills/talents pack, when resolvable. */
							key: new foundry.data.fields.StringField({ initial: "" }),
							/** Verbatim name fallback ("Performer (Choose One)"). */
							name: new foundry.data.fields.StringField({ initial: "" }),
							type: new foundry.data.fields.StringField({
								choices: { skill: "CAREER.TYPE_SKILL", talent: "CAREER.TYPE_TALENT" },
								initial: "skill",
								required: true,
								nullable: false,
							}),
							cost: new foundry.data.fields.NumberField({
								integer: true,
								min: 0,
								initial: 0,
							}),
							/** Multiplier advances (book "(x2)" rows). */
							multiplier: new foundry.data.fields.NumberField({
								integer: true,
								min: 1,
								initial: 1,
							}),
							/** Verbatim prerequisite strings (structured later, cf. tfk). */
							prerequisites: new foundry.data.fields.ArrayField(
								new foundry.data.fields.StringField(),
								{ initial: () => [] },
							),
						}),
						{ initial: () => [] },
					),
				}),
				{ initial: () => [] },
			),
		};
	}

	/** Ranks sorted ascending (1-8 in the core book; splats may add more). */
	get sortedRanks(): CareerRank[] {
		return [...(this.ranks ?? [])].sort((a, b) => a.rank - b.rank);
	}

	/** The rank entry for a given rank number, if present. */
	rankEntry(rank: number): CareerRank | undefined {
		return (this.ranks ?? []).find((r) => r.rank === rank);
	}
}

export interface CareerRank {
	rank: number;
	xpLevel: number;
	advances: Array<{
		key: string;
		name: string;
		type: string;
		cost: number;
		multiplier: number;
		prerequisites: string[];
	}>;
}