import { DamageType } from "./damage-types";
import { effectsField, type EffectData } from "./effects";
import { sourceField } from "./source";
import { psychicDisciplines } from "../../registry";

/** Psychic power sub-types (RT core, VERIFY against the book when seeding). */
export const psychicPowerSubtypes = [
	"focus",
	"bolt",
	"barrage",
	"storm",
	"zone",
] as const;

/** Power class: bound (safe, disciplined) vs unbound (raw, pushable). */
export const psychicPowerClasses = ["bound", "unbound"] as const;

/**
 * How an owned copy of a power is cast (epic 0hap): blank inherits the
 * actor's mode, "psychic" forces the psyker rules, "sorcery" the Sorcery
 * rules (Edge of the Abyss pp85-87).
 */
export const psychicPowerCastAs = ["psychic", "sorcery"] as const;

/**
 * Psychic powers as Items (mirrors Talent): actors own `psychicpower` Items;
 * the catalog lives in compendium packs. Mechanical use in the attack/test
 * flow comes later; for now this is the content schema the pack needs.
 */
export class PsychicPower extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["PSYCHIC_POWER"];

	declare prerequisite: string;
	declare powerClass: string;
	declare subtype: string;
	declare rating: number;
	declare range: string;
	declare damage: string;
	declare damageType: string;
	declare sustained: boolean;
	declare shortDescription: string;
	declare effects: EffectData[];
	/** How the owned copy is cast (epic 0hap): "" inherits the actor's mode. */
	declare castAs: string;
	/** Restricted technique (epic 0hap): elite-advance/GM use only. */
	declare restricted: boolean;

	static override defineSchema() {
		return {
			/** Free-text prerequisite (e.g. "WP 40, Discipline (Telepathy)"). */
			prerequisite: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Bound vs unbound discipline. */
			powerClass: new foundry.data.fields.StringField({
				choices: psychicPowerClasses,
				initial: "bound",
				required: true,
				nullable: false,
			}),
			/** Focus / bolt / barrage / storm / zone. */
			subtype: new foundry.data.fields.StringField({
				choices: psychicPowerSubtypes,
				initial: "focus",
				required: true,
				nullable: false,
			}),
			/**
			 * Discipline the technique belongs to (bead hkc5 schema
			 * prerequisite): registry key into psychicDisciplines (Core
			 * Rulebook p159 seed: telepathy/telekinesis/divination; splats
			 * register more at init). Blank for legacy/un-grouped entries.
			 */
			discipline: new foundry.data.fields.StringField({
				choices: psychicDisciplines.choices,
				initial: "",
				// Blank for legacy/un-grouped entries: `choices` otherwise flips
				// the StringField `blank` default to false and the empty value
				// fails validation (psykana-malifica + renegade powers).
				blank: true,
			}),
			/** Psy rating multiplier or flat rating captured raw. */
			rating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/** Range expression, e.g. "10 x PR m" (free text, book varies). */
			range: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Damage expression, e.g. "1d10+5 E". */
			damage: new foundry.data.fields.StringField({
				initial: "",
			}),
			damageType: new foundry.data.fields.StringField({
				choices: Object.values(DamageType),
				initial: DamageType.Energy,
				required: true,
				nullable: false,
			}),
			/** Sustained powers stay active across rounds. */
			sustained: new foundry.data.fields.BooleanField({
				initial: false,
			}),
			/**
			 * How the OWNED copy is cast (epic 0hap): "" inherits the actor's
			 * casting mode; "psychic" forces the psyker rules; "sorcery" applies
			 * the Sorcery rules (Intelligence Focus Power Test, Int-Bonus Psy
			 * Rating). Set to "sorcery" when a Sorcery talent grants the
			 * technique, so psyker/sorcerer hybrids cast each power correctly.
			 */
			castAs: new foundry.data.fields.StringField({ initial: "" }),
			/**
			 * Restricted technique (epic 0hap): the Psykana Malifica powers
			 * (Edge of the Abyss p82) "cannot be taken by Astropaths as part of
			 * their standard advance scheme" — the picker marks them for
			 * elite-advance/GM use rather than silently hiding them.
			 */
			restricted: new foundry.data.fields.BooleanField({ initial: false }),
			/** Short free-text description shown in pickers. */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * Full rulebook prose (bead qbha: both flavours — terse table
			 * data lives in the fields above, effect prose here).
			 */
			description: new foundry.data.fields.HTMLField({
				initial: "",
			}),
			/**
			 * Effect list (bead sa6, design mso6 addendum): same shared shape
			 * as talents/gear (data/item/effects.ts). test-modifier kinds feed
			 * the funnel for Focus Power Tests (powers are "known" items like
			 * talents — effectsAreLive); other kinds go to registered handlers.
			 */
			effects: effectsField(),
			// Source attribution (bead zzlq): books.yaml slug + printed page.
			source: sourceField(),
			/** Focus Power Test characteristic/skill (e.g. "Willpower"). */
			focusTest: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Focus time, e.g. "Half Action" (Core Rulebook Tables 6-4..6-15). */
			focusTime: new foundry.data.fields.StringField({
				initial: "",
			}),
			/** Technique tree ("telepathic-communication", ...). */
			tree: new foundry.data.fields.StringField({
				initial: "",
			}),
		};
	}
}
