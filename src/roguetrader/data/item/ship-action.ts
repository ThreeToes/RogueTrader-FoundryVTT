import { sourceField } from "./source";
import { textField } from "../fields";

/**
 * Ship action (epic necp bead oumh, Core Rulebook Ch. VIII pp213-218): one
 * Table 8-10 Manoeuvre Action or Table 8-11 Extended Action row. A dedicated
 * `ship-action` Item type — NOT the `action` combat-action type (owner
 * decision 2: a new type for the space-combat actions, not the Table 9-4
 * route-table extension), because the ship actions roll on the STARSHIP via
 * the combined-test contract (character skill + ship ability, p212), which
 * the personal-combat action handler has no vocabulary for.
 *
 * Schema follows the printed columns, mirroring the CombatAction shape:
 * - `actionCost` is the printed cost ("Strategic Turn", "Half Action", "1
 *   Strategic Turn per VU", ...).
 * - `roll.test` is the machine test key, `+`-composed: the character-side
 *   skill key first, the ship-side ability second (e.g.
 *   "pilot-space-craft+manoeuvrability", "tech-use", "scrutiny+detection").
 *   The vocabulary the handler resolves lives in
 *   presentation/rolls/ship-action.ts and is pinned by the pack guard test.
 * - `roll.difficulty` is the printed difficulty token ("Challenging (+0)",
 *   "Hard (-20)", "Difficult (-10)"), classified through the shared
 *   actionDifficulty ladder (rules/actions.ts).
 * - `description` is the book's FULL verbatim prose, never summarised.
 */
export class ShipAction extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["SHIP_ACTION"];

	declare actionCost: string;
	declare roll: { test: string; difficulty: string };
	declare shortDescription: string;
	declare description: string;

	static override defineSchema() {
		return {
			/** Printed action cost, verbatim. */
			actionCost: textField(),
			/** The printed test spec when the action calls for one. */
			roll: new foundry.data.fields.SchemaField({
				/** Machine test key(s), `+`-composed ("pilot-space-craft+manoeuvrability"). */
				test: textField(),
				/** Printed difficulty token, e.g. "Challenging (+0)". */
				difficulty: textField(),
			}),
			/** The table row's terse printed description. */
			shortDescription: textField(),
			/** The book's full verbatim prose. */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			source: sourceField(),
		};
	}
}