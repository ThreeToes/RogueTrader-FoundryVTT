/**
 * Unified actor data model shared by the pc/npc Actor subtypes.
 *
 * Structure-first: raw data capture only. Derived formulas (wounds
 * calculation, movement multipliers, carrying capacity) are intentionally
 * absent and belong to the rules layer later. The only derived values exposed
 * here are characteristic bonuses, which are definitional (bonus = value/10,
 * effective bonus = bonus x unnatural multiplier).
 */

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
			 * Carrying capacity in kg. Manual entry for now: aggregation and
			 * encumbrance states are rules-layer work (bead nju).
			 */
			maxCarriage: new foundry.data.fields.NumberField({
				min: 0,
				initial: 0,
			}),
			/** NPC threat level (e.g. "Trivial", or a descriptive rating). */
			threatLevel: new foundry.data.fields.StringField({
				initial: "",
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
}
