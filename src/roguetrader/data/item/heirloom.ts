import { Gear } from "./gear";

/**
 * Heirloom items (epic 1gb7 follow-up, Core Rulebook Table 1-2 p31): one Item
 * per heirloom, carrying the GRANT payload the character creator applies when
 * the Pride motivation's "Heirloom Item" alternative is rolled. Moved out of
 * rules/origins.ts so the verbatim table prose (which stays in the
 * `creationtables` RollTable "Table 1-2: Heirloom Items") and the grant
 * machinery live in data, not shipped code.
 *
 * Linkage: `key` matches the source RollTable result's
 * `flags.rogue-trader.item`; `table` names that RollTable so the pair stays
 * discoverable. `range` mirrors the table row so the creator can resolve a
 * 1d100 without loading the RollTable (a pack test guards the two against
 * drift).
 *
 * `grant.kind`: "pack-item" clones `grant.pack`/`grant.item` (with optional
 * craftsmanship override + rename); "note-item" creates a description-only
 * special-ability item from `grant.noteText`. Inherits description/source/
 * effects from Gear (availability/craftsmanship are Gear initials).
 */
export class Heirloom extends Gear {
	static LOCALIZATION_PREFIXES = ["HEIRLOOM"];

	declare key: string;
	declare table: string;
	declare range: { low: number; high: number };
	declare grant: {
		kind: string;
		pack: string;
		item: string;
		craftsmanship: string;
		rename: string;
		noteText: string;
	};

	static override defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			/** Stable slug; matches the source RollTable result's item flag. */
			key: new fields.StringField({ initial: "" }),
			/** Source RollTable ("creationtables/Table 1-2: Heirloom Items"). */
			table: new fields.StringField({ initial: "" }),
			/** 1d100 range of the source table row (drift-guarded by a test). */
			range: new fields.SchemaField({
				low: new fields.NumberField({ min: 1, integer: true, initial: 1 }),
				high: new fields.NumberField({ min: 1, integer: true, initial: 1 }),
			}),
			/** How the creator grants this heirloom. */
			grant: new fields.SchemaField({
				kind: new fields.StringField({
					choices: { "pack-item": "HEIRLOOM.KIND_PACK_ITEM", "note-item": "HEIRLOOM.KIND_NOTE_ITEM" },
					initial: "pack-item",
					required: true,
					nullable: false,
				}),
				/** pack-item: compendium pack id to clone from. */
				pack: new fields.StringField({ initial: "" }),
				/** pack-item: source item name in that pack. */
				item: new fields.StringField({ initial: "" }),
				/** pack-item: craftsmanship override (e.g. "best"). */
				craftsmanship: new fields.StringField({ initial: "" }),
				/** pack-item: rename the clone (book's own item name). */
				rename: new fields.StringField({ initial: "" }),
				/** note-item: description for the granted special-ability item. */
				noteText: new fields.StringField({ initial: "" }),
			}),
		};
	}
}
