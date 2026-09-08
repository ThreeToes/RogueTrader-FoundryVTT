import { CHARACTERISTIC_KEYS } from "../actor/character";
import { sourceField } from "./source";

/**
 * Navigator powers (bead sa6, Core Rulebook Ch. VII book pp178-181). Distinct
 * from psychic powers by design (owner decision on bead mso6: same general
 * flow, different test config — NOT a fork):
 *
 * - No Focus Power Test, no Psy Rating, never Psychic Phenomena/Perils
 *   (book p178). Activation = a plain Characteristic Test (most commonly
 *   Willpower or Perception).
 * - Mastery bonus by level: +0 Novice, +10 Adept, +20 Master (book p178).
 * - Each power's description carries Novice/Adept/Master prose.
 *
 * The navigatorpowers pack extraction (bead 5p15) seeds this schema.
 */
export class NavigatorPower extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Item
> {
	static LOCALIZATION_PREFIXES = ["NAVIGATOR_POWER"];

	declare characteristic: string;
	declare mastery: string;
	declare levels: { novice: string; adept: string; master: string };
	declare description: string;
	declare shortDescription: string;

	/** Mastery levels with their book test bonuses (book p178). */
	static masteryBonus: Record<string, number> = {
		novice: 0,
		adept: 10,
		master: 20,
	};

	static get characteristicChoices(): Record<string, string> {
		// Navigator powers test Characteristics directly (book p178: Willpower
		// and Perception are most common; per-power characteristic comes from
		// the extraction's per-power note).
		return Object.fromEntries(
			CHARACTERISTIC_KEYS.map((key) => [
				key,
				`CHARACTERISTIC.${key.toUpperCase()}`,
			]),
		);
	}

	static override defineSchema() {
		return {
			/** Characteristic tested on activation (e.g. "willpower"). */
			characteristic: new foundry.data.fields.StringField({
				choices: NavigatorPower.characteristicChoices,
				initial: "perception",
				required: true,
				nullable: false,
			}),
			/** Current mastery level: novice / adept / master (book p178). */
			mastery: new foundry.data.fields.StringField({
				choices: ["novice", "adept", "master"],
				initial: "novice",
				required: true,
				nullable: false,
			}),
			/** Level prose from the book (Novice/Adept/Master paragraphs). */
			levels: new foundry.data.fields.SchemaField({
				novice: new foundry.data.fields.HTMLField({ initial: "" }),
				adept: new foundry.data.fields.HTMLField({ initial: "" }),
				master: new foundry.data.fields.HTMLField({ initial: "" }),
			}),
			/** Intro prose (power description above the level paragraphs). */
			description: new foundry.data.fields.HTMLField({ initial: "" }),
			/** Short free-text description shown in pickers. */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			// Source attribution (bead zzlq): books.yaml slug + printed page.
			source: sourceField(),
		};
	}

	/** The mastery test bonus for this power's current level (book p178). */
	get masteryBonusValue(): number {
		return NavigatorPower.masteryBonus[this.mastery] ?? 0;
	}
}