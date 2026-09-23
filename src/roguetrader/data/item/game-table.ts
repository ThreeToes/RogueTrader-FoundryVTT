import { sourceField } from "./source";
import { textField } from "../fields";

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
 * vehicle-critical rows carry `hullSection`/`zone`; ship-table crew-rating rows
 * carry `rating`. Optional fields default empty/0 and unused ones stay blank.
 */
export class GameTable extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["GAME_TABLE"];

	declare kind: string;
	declare roll: string;
	declare rating: number;
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
			kind: textField(),
			/** Raw roll range as printed, e.g. "2-3 (Rocky)" or "1-5". */
			roll: textField(),
			/** NPC crew skill/characteristic rating (ship tables, Table 8-9). */
			rating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Named difficulty for ladder tables, e.g. "Challenging". */
			difficulty: textField(),
			/** Named complexity for exploration/investigation tables. */
			complexity: textField(),
			/** Benchmark durations, e.g. "72 hours" / "1d5 years". */
			time: textField(),
			/** Vehicle criticals: affected zone label. */
			zone: textField(),
			/** Vehicle criticals: affected hull section. */
			hullSection: textField(),
			/** Familiar/availability ladder text. */
			availability: textField(),
			/** Dispositions-table skill columns (Core Rulebook p279). */
			charm: textField(),
			command: textField(),
			deceive: textField(),
			intimidate: textField(),
			size: textField(),
			concealment: textField(),
			movement: textField(),
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
			threshold: textField(),
			/** Encounter-difficulty XP award. */
			xp: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			shortDescription: textField(),
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			source: sourceField(),
		};
	}
}