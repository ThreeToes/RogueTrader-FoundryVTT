import { sourceField } from "./source";
import { textField } from "../fields";

/**
 * Starting Kit (owner rework 2026): one Item per career kit, delivered by the
 * `character-options` pack, keyed by the matching Career's system key. The
 * book prints a STARTING GEAR block per career sentence-grouped: "A or B or
 * C. D, E, F..." — Curation turns each printed alternative ("or") group into
 * a SLOT whose OPTIONS are pick-one; a fixed row is a slot with ONE option.
 *
 * An option references a real pack document when the gear exists in the
 * equipment sources (source folder + exact name, craftsmanship/quantity
 * overrides, pre-attached weapon mods like mono); when no pack doc EXISTS
 * yet the option is a `note` — the grant is a description-only gear Item
 * carrying the book name + verbatim text with its cite (the Ancestral Seal
 * precedent), never a fabricated statblock. The pack test resolves every
 * structured option against the sources LOUDLY, so authoring cannot drop a
 * slot silently.
 *
 * Schema-first per the repo conventions: no taxonomy the book does not define
 * (slots/options mirror the printed block's own "or"/comma structure).
 */
export interface GearsetItemRef {
	/** Equipment source folder (weapons/armour/gear/drugs/tools/cybernetics). */
	source: string;
	/** Exact pack document name. */
	name: string;
	/** Grant-time rename (pattern-specific doc -> the book's generic name). */
	rename?: string;
	/** Craftsmanship override (book: "Best-Craftsmanship…"). */
	craftsmanship?: string;
	/** Count for quantity rows ("2 bottles of amasec"). */
	quantity?: number;
	/** Weapon-modification pack names installed at grant (e.g. mono). */
	mods?: string[];
}

export interface GearsetNote {
	/** Verbatim-ish title (usually the book's own item text). */
	name: string;
	/** The verbatim block fragment; becomes the granted item's description. */
	description?: string;
}

export interface GearsetOption {
	/** Structured option: resolve by (source, name) against the equipment sources. */
	source?: string;
	/** Exact pack document name — for note rows, the granted item's title. */
	name: string;
	/** Grant-time rename (pattern-specific doc -> the book's generic name). */
	rename?: string;
	/** Note option: no pack row exists; grant a description-only gear Item. */
	note?: boolean;
	/** The note's verbatim text (the granted description). */
	description?: string;
	/** Craftsmanship override (book: "Best-Craftsmanship…"). */
	craftsmanship?: string;
	/** Count for quantity rows ("2 bottles of amasec"). */
	quantity?: number;
	/** Weapon-modification pack names installed at grant (e.g. mono). */
	mods?: string[];
}

/** One slot: several options = pick one (the book's "or"); one = fixed. */
export interface GearsetSlot {
	/** The verbatim quote the slot was curated from (pack-test spot-check). */
	quote?: string;
	options: GearsetOption[];
}

export class Gearset extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["GEARSET"];

	declare key: string;
	/** Display label ("Starting Kit — <Career>"). */
	declare label: string;
	/** Human-readable description (HTML, like every typed item). */
	declare description: string;
	/** The book's verbatim STARTING GEAR block (curation proof). */
	declare quote: string;
	declare source: { book: string; page: number };
	declare slots: GearsetSlot[];

	static override defineSchema() {
		const fields = foundry.data.fields;
		return {
			/** The matching career's system key (the kit lookup). */
			key: textField(),
			label: textField(),
			description: new fields.HTMLField({ initial: "" }),
			quote: textField(),
			source: sourceField(),
			slots: new fields.ArrayField(
				new fields.SchemaField({
					quote: textField(),
					options: new fields.ArrayField(
						new fields.SchemaField({
							/** Equipment source folder the item resolves in. */
							source: textField(),
							/** Exact pack document name (with source above). */
							name: textField(),
							/** Grant-time rename (pattern-specific doc -> the book's generic name). */
							rename: textField(),
							/** No-pack-row fallback: description-only gear. */
							note: new fields.BooleanField({ initial: false }),
							description: textField(),
							craftsmanship: textField(),
							quantity: new fields.NumberField({
								integer: true,
								min: 1,
								initial: 1,
								required: true,
							}),
							/** Weapon-modification pack names installed at grant. */
							mods: new fields.ArrayField(
								new fields.StringField({ required: true, nullable: false, initial: "" }),
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

	/** Slots with a real pick-one choice (the "or" groups). */
	get choiceSlots(): number[] {
		return (this.slots ?? [])
			.map((slot, index) => ({ slot, index }))
			.filter(({ slot }) => (slot?.options?.length ?? 0) > 1)
			.map(({ index }) => index);
	}
}

/** Plain structural view the pure rules layer consumes. */
export interface GearsetEntry {
	key: string;
	label: string;
	quote: string;
	source: { book?: string; page?: number };
	slots: GearsetSlot[];
}