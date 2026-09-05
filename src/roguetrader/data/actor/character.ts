/**
 * Unified actor data model shared by the pc/npc Actor subtypes.
 *
 * Structure-first: raw data capture only. Derived formulas (wounds
 * calculation, movement multipliers, carrying capacity) are intentionally
 * absent and belong to the rules layer later. The only derived values exposed
 * here are characteristic bonuses, which are definitional (bonus = value/10,
 * effective bonus = bonus x unnatural multiplier).
 */

import { careers } from "../../registry";

export const CHARACTERISTIC_KEYS = [
	"ws",
	"bs",
	"s",
	"t",
	"ag",
	"int",
	"per",
	"wp",
	"fel",
] as const;

export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

export class Character extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["CHARACTER"];

	declare characteristics: Record<string, { value: number; unnatural: number }>;
	declare wounds: { value: number; max: number };
	declare fatigue: number;
	declare fate: { value: number; max: number };
	declare insanity: number;
	declare corruption: number;
	declare threatLevel: string;
	declare careerKey: string;
	declare rank: number;
	declare xp: { spent: number; total: number };
	declare description: string;
	declare advances: Array<{
		type: "skill" | "talent" | "characteristic";
		key: string;
		name: string;
		characteristic?: string;
		cost: number;
		rank: number;
		tier?: string;
		source?: string;
		elite?: boolean;
	}>;

	static override defineSchema() {
		const characteristic = () =>
			new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					max: 100,
					integer: true,
					initial: 25,
					required: true,
				}),
				/** Unnatural characteristic multiplier (1 = natural). */
				unnatural: new foundry.data.fields.NumberField({
					min: 1,
					integer: true,
					initial: 1,
					required: true,
				}),
			});

		return {
			characteristics: new foundry.data.fields.SchemaField({
				ws: characteristic(),
				bs: characteristic(),
				s: characteristic(),
				t: characteristic(),
				ag: characteristic(),
				int: characteristic(),
				per: characteristic(),
				wp: characteristic(),
				fel: characteristic(),
			}),
			wounds: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				max: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			fatigue: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			fate: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				max: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			insanity: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			corruption: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/**
			 * XP purchase ledger (bead g7k): every advance bought, the audit
			 * trail behind xp.spent (total = 4,500 creation baseline + ledger
			 * sum, see rules/advancement). GM refunds/undo remove entries.
			 * rank 0 marks creation-baseline/elite advances.
			 */
			advances: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					type: new foundry.data.fields.StringField({
						choices: { skill: "ADVANCE.TYPE_SKILL", talent: "ADVANCE.TYPE_TALENT", characteristic: "ADVANCE.TYPE_CHARACTERISTIC" },
						initial: "skill",
						required: true,
						nullable: false,
					}),
					key: new foundry.data.fields.StringField({ initial: "" }),
					name: new foundry.data.fields.StringField({ initial: "" }),
					characteristic: new foundry.data.fields.StringField({ initial: "" }),
					cost: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					rank: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 1,
					}),
					tier: new foundry.data.fields.StringField({ initial: "" }),
					source: new foundry.data.fields.StringField({ initial: "" }),
					elite: new foundry.data.fields.BooleanField({ initial: false }),
				}),
				{ initial: () => [] },
			),
			/** NPC threat level (e.g. "Trivial", or a descriptive rating). */
			threatLevel: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * Career reference: registry key into CONFIG.ROGUE_TRADER.careers
			 * (bead 0ib). Homebrew careers registered at init are pickable too;
			 * the label resolves via the registry, not stored text.
			 */
			careerKey: new foundry.data.fields.StringField({
				choices: careers.choices,
				initial: "",
				// No career selected yet (new PC / pre-creator) is valid.
				blank: true,
			}),
			/**
			 * Current rank within the career (1-8 in core; splat books may add
			 * more). XP-derived rank suggestion is display-only until an
			 * advancement engine exists — multiple eligible ranks are a choice.
			 */
			rank: new foundry.data.fields.NumberField({
				min: 1,
				integer: true,
				initial: 1,
			}),
			/** Experience points: spent and total, header display as spent/total. */
			xp: new foundry.data.fields.SchemaField({
				spent: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				total: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			description: new foundry.data.fields.HTMLField(),
		};
	}

	/** Characteristic bonus: floor(value / 10), ignoring unnatural multiplier. */
	characteristicBonus(key: string): number {
		return Math.floor((this.characteristics[key]?.value ?? 0) / 10);
	}

	/** Effective characteristic bonus, including the unnatural multiplier. */
	effectiveCharacteristicBonus(key: string): number {
		return (
			this.characteristicBonus(key) *
			(this.characteristics[key]?.unnatural ?? 1)
		);
	}

	/** Agility Bonus shorthand used by movement + initiative (definitional). */
	agilityBonus(): number {
		return this.characteristicBonus("ag");
	}

	/**
	 * Derived movement in AB-units: half = max(1, AB-1), full = AB,
	 * charge = AB×2, run = AB×3. (Multiplier rules best-remembered RT core,
	 * VERIFY against the book - display unit decided by the UI layer.)
	 */
	movement(): { half: number; full: number; charge: number; run: number } {
		const ab = this.agilityBonus();
		return {
			half: Math.max(1, ab - 1),
			full: ab,
			charge: ab * 2,
			run: ab * 3,
		};
	}

	/** Derived initiative bonus: the Agility Bonus (talent modifiers join via the funnel). */
	initiativeBonus(): number {
		return this.agilityBonus();
	}
}
