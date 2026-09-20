import { originRowChoices } from "../../rules/origins";
import { CHARACTERISTIC_KEYS } from "../actor/character";
import { Gear } from "./gear";

/**
 * Origin Path chart entries (epic 1gb7, Core Rulebook Chapter I pp16-35):
 * one Item per chart option, resolved at creation time by the character
 * creator. Moved out of rules/origins.ts (which keeps the pure machinery:
 * adjacency, dice, fate, mechanics merge) so the verbatim book text lives in
 * the private packs repo and never ships in system code — the extraction
 * convention.
 *
 * Shape mirrors the old `OriginEntry` interface exactly so the creator's
 * helpers keep working: key/row/col drive the p16 chart graph; `mechanics`
 * is the machine-applicable subset; `variants` are choose-one sub-results.
 * `description`/`source`/`effects` are inherited from Gear (availability and
 * equip state are meaningless here — carried as Gear initials).
 */
export class Origin extends Gear {
	static LOCALIZATION_PREFIXES = ["ORIGIN"];

	declare key: string;
	declare row: string;
	declare col: number;
	/**
	 * Core origin key this entry SUBSTITUTES for (bead b03f). Splatbook
	 * alternates are not extra chart columns: the book says "On the Origin Path
	 * chart, Frontier World may be taken instead of Death World", and the chart
	 * is a +/-1 column-adjacency graph (rules/origins.ts allowedColumns), so
	 * appending a column would corrupt every pick. Blank = an ordinary entry.
	 */
	declare replaces: string;
	/**
	 * Species this path entry belongs to (bead ghmn); blank = human. Xenos have
	 * their own path (Into the Storm p48: the Kroot "do not use the Origin
	 * Path"), so the creator gives a species only the rows its own entries
	 * declare — a Kroot sees Kindred, never a human Home World.
	 */
	declare species: string;
	declare effect: string;
	declare mechanics: Record<string, unknown>;
	declare variants: Array<Record<string, unknown>>;

	static override defineSchema() {
		const fields = foundry.data.fields;
		const charMod = () =>
			new fields.SchemaField({
				key: new fields.StringField({
					choices: Object.fromEntries(CHARACTERISTIC_KEYS.map((k) => [k, k])),
					initial: "s",
				}),
				value: new fields.NumberField({ integer: true, initial: 0 }),
			});
		const fateBand = () =>
			new fields.SchemaField({
				max: new fields.NumberField({ integer: true, initial: 0 }),
				value: new fields.NumberField({ integer: true, initial: 0 }),
			});
		const stringList = () =>
			new fields.ArrayField(new fields.StringField({ initial: "" }), {
				initial: () => [],
			});

		/**
		 * Leaf mechanics: everything except `alternateChoice`. Used for the
		 * inner blob of an alternateChoice (the book never nests one inside
		 * another, verified across all three usages).
		 */
		const leafMechanicsFields = () => ({
			characteristics: new fields.ArrayField(charMod(), { initial: () => [] }),
			characteristicChoice: new fields.ArrayField(
				new fields.ArrayField(charMod()),
				{ initial: () => [] },
			),
			skills: stringList(),
			talents: stringList(),
			optionChoice: stringList(),
			woundsDice: new fields.StringField({ initial: "" }),
			woundBonus: new fields.NumberField({ integer: true, initial: 0 }),
			fateTable: new fields.ArrayField(fateBand(), { initial: () => [] }),
			fateDelta: new fields.NumberField({ integer: true, initial: 0 }),
			insanity: new fields.NumberField({ integer: true, initial: 0 }),
			insanityDice: new fields.StringField({ initial: "" }),
			corruption: new fields.NumberField({ integer: true, initial: 0 }),
			corruptionDice: new fields.StringField({ initial: "" }),
			corruptionOrInsanityDice: new fields.StringField({ initial: "" }),
			initiativeBonus: new fields.NumberField({ integer: true, initial: 0 }),
			profitFactor: new fields.NumberField({ integer: true, initial: 0 }),
			notes: stringList(),
		});
		const mechanicsFields = () => ({
			...leafMechanicsFields(),
			alternateChoice: new fields.ArrayField(
				new fields.SchemaField({
					label: new fields.StringField({ initial: "" }),
					mechanics: new fields.SchemaField(leafMechanicsFields()),
				}),
				{ initial: () => [] },
			),
		});

		return {
			...super.defineSchema(),
			/** Chart key (e.g. "death-world"); referenced by system.origins picks. */
			key: new fields.StringField({ initial: "" }),
			/** Chart row (p16): home-world | birthright | lure | trials | motivation | lineage,
			 *  plus the xeno paths' rows (kindred | klan | know-wotz | competence).
			 *
			 * MUST be the WHOLE chart vocabulary, not ORIGIN_ROWS: that constant is the
			 * human path only, and a `choices` list narrower than the data silently
			 * coerces every out-of-vocabulary value to `initial` — which put all 23
			 * xeno entries on the human Home World row (bug 2026-09-20). */
			row: new fields.StringField({
				choices: originRowChoices(),
				initial: "home-world",
			}),
			/** Column index (0-based) on the p16 chart; adjacency uses this. */
			col: new fields.NumberField({ min: 0, integer: true, initial: 0 }),
			/**
			 * Splatbook alternate: the core origin key it may be taken INSTEAD of
			 * (bead b03f). Blank on every core entry. The creator offers such an
			 * entry as an alternative AT that column rather than as a new column,
			 * because the chart's reachability is column adjacency.
			 */
			replaces: new fields.StringField({ initial: "" }),
			/** Species path binding (bead ghmn); blank = the human Origin Path. */
			species: new fields.StringField({ initial: "" }),
			/** Verbatim effect text for options without variants. */
			effect: new fields.StringField({ initial: "" }),
			/** Machine-applicable mechanics (see rules/origins.ts OriginMechanics). */
			mechanics: new fields.SchemaField(mechanicsFields()),
			/** Choose-one sub-results (Criminal, Renegade, Tainted, Zealot...). */
			variants: new fields.ArrayField(
				new fields.SchemaField({
					key: new fields.StringField({ initial: "" }),
					name: new fields.StringField({ initial: "" }),
					effect: new fields.StringField({ initial: "" }),
					mechanics: new fields.SchemaField(mechanicsFields()),
				}),
				{ initial: () => [] },
			),
		};
	}
}
