/**
 * DATA-tab effect actions shared by the talent/gear/weapon/armour sheets
 * (bead bpd follow-up): add appends a blank row, remove drops the row at the
 * control's data-index. Pure list surgery lives in data/item/effects.ts;
 * these handlers only read the DOM index and issue the update
 * (submitOnChange keeps the sheet in sync).
 */

import {
	CHARACTERISTIC_KEYS,
} from "../../data/actor/character";
import { withAddedEffect, withoutEffectAt } from "../../data/item/effects";
import { talentEffectHandlers } from "../../rules/talent-effects";

interface EffectsSheet {
	document: {
		system: { effects?: unknown[] };
		update: (data: Record<string, unknown>) => Promise<unknown>;
	};
}

export const effectActions = {
	/** Append a blank effect row (data-action="addEffect"). */
	async addEffect(this: EffectsSheet): Promise<void> {
		await this.document.update({
			"system.effects": withAddedEffect(
				this.document.system.effects as never,
			),
		});
	},

	/** Remove the effect row named by the control's data-index. */
	async removeEffect(
		this: EffectsSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index);
		if (!Number.isInteger(index)) return;
		await this.document.update({
			"system.effects": withoutEffectAt(
				this.document.system.effects as never,
				index,
			),
		});
	},
};

// ---------------------------------------------------------------------------
// Editor choices: localized labels for the effect-kind and test-key dropdowns
// so authors never type slugs or characteristic keys by hand.
// ---------------------------------------------------------------------------

/** Characteristic key -> i18n suffix under CHARACTERISTIC.*. */
const CHARACTERISTIC_LABEL_SUFFIX: Record<string, string> = {
	ws: "WEAPON_SKILL",
	bs: "BALLISTIC_SKILL",
	s: "STRENGTH",
	t: "TOUGHNESS",
	ag: "AGILITY",
	int: "INTELLIGENCE",
	per: "PERCEPTION",
	wp: "WILLPOWER",
	fel: "FELLOWSHIP",
};

/** Known effect kinds -> i18n key under EFFECT_KIND.*. */
const EFFECT_KIND_LABEL_KEYS: Record<string, string> = {
	"test-modifier": "EFFECT_KIND.TEST_MODIFIER",
	"attack-modifier": "EFFECT_KIND.ATTACK_MODIFIER",
	"wounds-max": "EFFECT_KIND.WOUNDS_MAX",
	"skill-rank": "EFFECT_KIND.SKILL_RANK",
	"damage-flat": "EFFECT_KIND.DAMAGE_FLAT",
	"critical-damage": "EFFECT_KIND.CRITICAL_DAMAGE",
};

/**
 * Dropdown choices for the shared effect editor: `kindChoices` maps kind ->
 * localized label (registered module kinds fall back to the raw kind);
 * `testKeyChoices` maps key -> localized label with "" = all tests.
 */
export function effectEditorChoices(localize: (key: string) => string): {
	kindChoices: Record<string, string>;
	testKeyChoices: Record<string, string>;
} {
	const kindChoices: Record<string, string> = {};
	for (const kind of ["test-modifier", ...talentEffectHandlers.kinds()]) {
		const labelKey = EFFECT_KIND_LABEL_KEYS[kind];
		kindChoices[kind] = labelKey ? localize(labelKey) : kind;
	}
	const testKeyChoices: Record<string, string> = {
		"": localize("EFFECTS.ALL_TESTS"),
	};
	for (const key of CHARACTERISTIC_KEYS) {
		const suffix = CHARACTERISTIC_LABEL_SUFFIX[key];
		if (suffix) testKeyChoices[key] = localize(`CHARACTERISTIC.${suffix}`);
	}
	return { kindChoices, testKeyChoices };
}