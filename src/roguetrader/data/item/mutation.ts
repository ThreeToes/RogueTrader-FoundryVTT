/**
 * Mutation table rows (bead bfdz): data for Table 14-3: Mutations (Core
 * p368-369) and later the Navigator set (Table 7-1). Rows are looked up by
 * d100 roll (corruption-track rolls, Tainted birthright). Text is verbatim;
 * mechanical hooks stay in `text` until effect kinds exist for them.
 */
import { textField } from "../fields";
import { afflictionProcedures } from "../../registry";
import { Gear } from "./gear";

/**
 * A mutation's printed attack profile (bead kam1). Only fields the BOOK prints
 * appear here: Corrosive Bile (Core Rulebook p369) prints a damage formula, two
 * damage-type alternatives, a quality, the test characteristic, the action cost
 * and whether it can be dodged/parried — and nothing else. There is
 * deliberately no Range, Penetration, Clip or Reload: the entry does not print
 * them, and filling in weapon-table values would fabricate rules.
 */
export interface MutationAttack {
	/** Test characteristic key: "ws" or "bs". Blank = no attack. */
	characteristic: string;
	/** Damage formula, e.g. "1d10+2". Blank = the mutation has no attack. */
	damage: string;
	/**
	 * Printed damage-type ALTERNATIVES as book letters ("R", "E"). A list
	 * because the book prints "1d10+2 R (or E)" — a single-valued field could
	 * not carry that without picking one and losing the other.
	 */
	damageTypes: string[];
	/** Weapon qualities the attack has, lowercase keys ("tearing"). */
	qualities: string[];
	/** Action cost ("full"); blank when the book does not print one. */
	action: string;
	/** "It can be dodged, but not parried." */
	dodgeable: boolean;
	parryable: boolean;
}

export class Mutation extends Gear {
	static LOCALIZATION_PREFIXES = ["MUTATION"];

	declare tableKey: string;
	declare rollMin: number;
	declare rollMax: number;
	declare procedure: string;
	declare attack: MutationAttack;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Which table the row belongs to ("mutations" | "navigator-mutations"). */
			tableKey: new foundry.data.fields.StringField({ initial: "mutations" }),
			/** Inclusive d100 band. */
			rollMin: new foundry.data.fields.NumberField({
				min: 1,
				max: 100,
				integer: true,
				initial: 1,
			}),
			rollMax: new foundry.data.fields.NumberField({
				min: 1,
				max: 100,
				integer: true,
				initial: 100,
			}),
			/**
			 * Acquisition-time procedure (bead xu83): a printed, one-off roll this
			 * mutation requires that no static effect row can express (Degenerate
			 * Mind's 1d10 trait pick; Mental Regressive's per-characteristic
			 * table). Blank = the authored effects are the whole rule. Validated
			 * against the registry so a typo fails loudly (rules/afflictions.ts).
			 */
			procedure: new foundry.data.fields.StringField({
				choices: afflictionProcedures.choices,
				initial: "",
				blank: true,
			}),
			/**
			 * Printed ATTACK profile (bead kam1), for mutations that are an attack
			 * rather than a passive trait — Corrosive Bile's "The mutant must test
			 * Ballistic Skill to use this mutation ... 1d10+2 R (or E) Tearing
			 * Damage." Kept on the mutation (not a synthetic weapon Item) so the
			 * entry stays the single source of truth and no weapon-table field has
			 * to be invented. An all-blank block means "no attack": the sheet
			 * renders no Attack action, and `damage` is the discriminator.
			 */
			attack: new foundry.data.fields.SchemaField({
				characteristic: textField(),
				damage: textField(),
				damageTypes: new foundry.data.fields.ArrayField(
					textField(),
					{ initial: () => [] },
				),
				qualities: new foundry.data.fields.ArrayField(
					textField(),
					{ initial: () => [] },
				),
				action: textField(),
				dodgeable: new foundry.data.fields.BooleanField({ initial: true }),
				parryable: new foundry.data.fields.BooleanField({ initial: false }),
			}),
		};
	}
}
