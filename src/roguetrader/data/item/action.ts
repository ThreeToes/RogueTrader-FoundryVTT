import { sourceField } from "./source";
import { textField } from "../fields";

/**
 * Combat action (bead moew): one row of Table 9-4: Combat Actions (Core
 * Rulebook pp237) plus its printed Action Descriptions prose (pp238-243).
 * A dedicated `action` Item type — NOT plain Gear and NOT `game-table`: the
 * actions tab (child bead of moew) consumes the structured cost/roll fields
 * for chip display and roll buttons, which a lookup-table or gear type drops.
 *
 * Schema follows the book's printed columns:
 * - `actionCost` is the printed Table 9-4 "Type" value — the book's set is
 *   exactly {Half, Full, Half/Full, Reaction, Varies}; when the row prints
 *   "Varies" the prose Type line's verbatim note (e.g. "Varies by Power")
 *   lives in `actionNote`.
 * - `roll` carries the printed test only when the prose specifies one
 *   (e.g. Called Shot's Hard (–20) Weapon Skill Test); `test` is the
 *   machine key pinned by the actions pack guard test.
 * - `subtypes`/`prerequisites` quote the printed Subtype(s) column / prose.
 * - `description` is the book's FULL verbatim prose, never summarised.
 */
export class CombatAction extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["ACTION"];

	declare actionCost: string;
	declare actionNote: string;
	declare subtypes: string;
	declare prerequisites: string;
	declare roll: { test: string; difficulty: string };
	declare shortDescription: string;
	declare description: string;

	static override defineSchema() {
		return {
			/** Printed Table 9-4 Type value: Half | Full | Half/Full | Reaction | Varies. */
			actionCost: textField(),
			/** Verbatim "Varies by …" note from the prose Type line (Varies rows only). */
			actionNote: textField(),
			/** Printed Subtype(s) column, verbatim. */
			subtypes: textField(),
			/** Printed prerequisite when the prose states one (e.g. a Heavy weapon). */
			prerequisites: textField(),
			/** The printed test spec when the action calls for a roll. */
			roll: new foundry.data.fields.SchemaField({
				/** Machine key, e.g. "ballistic-skill", "dodge", "opposed-strength". */
				test: textField(),
				/** Printed difficulty label, e.g. "Hard (–20)", "Challenging (+0)". */
				difficulty: textField(),
			}),
			/** The Table 9-4 row's terse printed description. */
			shortDescription: textField(),
			/** The book's full Action Descriptions prose, verbatim. */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			source: sourceField(),
		};
	}
}