import { CHARACTERISTIC_KEYS } from "../actor/character";

/**
 * Skills as Items (content-as-data): the RT core catalog ships as a
 * compendium pack, actors own `skill` Items and their advancement is the
 * ladder (Known/+10/+20). Specializations are just item names, e.g.
 * "Forbidden Lore (Heresy)".
 */
export class Skill extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["SKILL"];

	declare characteristic: string;
	declare ladder: number;

	static get characteristicChoices(): Record<string, string> {
		return Object.fromEntries([
			...CHARACTERISTIC_KEYS.map((key) => [
				key,
				`CHARACTERISTIC.${key.toUpperCase()}`,
			]),
		] as Array<[string, string]>);
	}

	static override defineSchema() {
		return {
			characteristic: new foundry.data.fields.StringField({
				choices: Skill.characteristicChoices,
				initial: "int",
				required: true,
				nullable: false,
			}),
			/** 1 = Known, 2 = +10, 3 = +20. */
			ladder: new foundry.data.fields.NumberField({
				min: 1,
				max: 3,
				integer: true,
				initial: 1,
				required: true,
			}),
			/** Granted to every newly-created pc/npc actor (catalog flag). */
			common: new foundry.data.fields.BooleanField({
				initial: false,
				required: true,
			}),
			/**
			 * Advanced skills cannot be attempted untrained (RT core; VERIFY
			 * per-skill classification against the book).
			 */
			advanced: new foundry.data.fields.BooleanField({
				initial: false,
				required: true,
			}),
		};
	}

	/** Skill ladder bonus over the characteristic value: 0/+10/+20. */
	get ladderBonus(): number {
		return (this.ladder - 1) * 10;
	}
}
