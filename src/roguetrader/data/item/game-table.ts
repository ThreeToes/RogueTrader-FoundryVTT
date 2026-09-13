import { sourceField } from "./source";

/**
 * Game reference table (bead hkc5/planet-actor owner ask): the gametables
 * compendium rows — SOI world/planetside generators, test difficulties,
 * movement ladders, vehicle criticals, etc. A dedicated `game-table` Item
 * type (NOT plain Gear: these are planet/system generation records the GM
 * attaches to `planet` actors, so they carry no availability/equip state).
 *
 * The column set is the union of every authored table's cells: most rows
 * carry just `roll` + prose; difficulty ladders carry `difficulty`/
 * `modifier`; exploration/investigation rows carry `complexity`/`degrees`/
 * `time`; disposition rows carry the skill-name columns (charm/command/...);
 * vehicle-critical rows carry `hullSection`/`zone`. Optional fields default
 * empty/0 and unused ones stay blank.
 */
export class GameTable extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["GAME_TABLE"];

	declare kind: string;
	declare roll: string;
	declare difficulty: string;
	declare complexity: string;
	declare time: string;
	declare zone: string;
	declare hullSection: string;
	declare availability: string;
	declare charm: string;
	declare command: string;
	declare deceive: string;
	declare intimidate: string;
	declare size: string;
	declare movement: string;
	declare modifier: number;
	declare degrees: number;
	declare threshold: string;
	declare xp: number;
	declare shortDescription: string;
	declare description: string;

	static override defineSchema() {
		return {
			/** Grouping key (GAME_TABLE_GROUPS kind → compendium folder). */
			kind: new foundry.data.fields.StringField({ initial: "" }),
			/** Raw roll range as printed, e.g. "2-3 (Rocky)" or "1-5". */
			roll: new foundry.data.fields.StringField({ initial: "" }),
			/** Named difficulty for ladder tables, e.g. "Challenging". */
			difficulty: new foundry.data.fields.StringField({ initial: "" }),
			/** Named complexity for exploration/investigation tables. */
			complexity: new foundry.data.fields.StringField({ initial: "" }),
			/** Benchmark durations, e.g. "72 hours" / "1d5 years". */
			time: new foundry.data.fields.StringField({ initial: "" }),
			/** Vehicle criticals: affected zone label. */
			zone: new foundry.data.fields.StringField({ initial: "" }),
			/** Vehicle criticals: affected hull section. */
			hullSection: new foundry.data.fields.StringField({ initial: "" }),
			/** Familiar/availability ladder text. */
			availability: new foundry.data.fields.StringField({ initial: "" }),
			/** Dispositions-table skill columns (Core Rulebook p279). */
			charm: new foundry.data.fields.StringField({ initial: "" }),
			command: new foundry.data.fields.StringField({ initial: "" }),
			deceive: new foundry.data.fields.StringField({ initial: "" }),
			intimidate: new foundry.data.fields.StringField({ initial: "" }),
			size: new foundry.data.fields.StringField({ initial: "" }),
			concealment: new foundry.data.fields.StringField({ initial: "" }),
			movement: new foundry.data.fields.StringField({ initial: "" }),
			/** Numeric modifier, e.g. test-difficulty +20. */
			modifier: new foundry.data.fields.NumberField({
				integer: true,
				initial: 0,
			}),
			/** Degrees of success needed/awarded. */
			degrees: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Threshold expressions kept raw (book varies, e.g. "91+"). */
			threshold: new foundry.data.fields.StringField({ initial: "" }),
			/** Encounter-difficulty XP award. */
			xp: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			shortDescription: new foundry.data.fields.StringField({ initial: "" }),
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			source: sourceField(),
		};
	}
}