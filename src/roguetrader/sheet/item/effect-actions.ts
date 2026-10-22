/**
 * DATA-tab effect actions shared by the talent/gear/weapon/armour sheets
 * (bead bpd follow-up): add appends a blank row, remove drops the row at the
 * control's data-index. Pure list surgery lives in data/item/effects.ts;
 * these handlers only read the DOM index and issue the update
 * (submitOnChange keeps the sheet in sync).
 */

import { characteristicLongLabels } from "../../registry";
import { withAddedEffect, withoutEffectAt } from "../../data/item/effects";
import { effectKinds } from "../../../ffg/domain/effects";

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
			"system.effects": withAddedEffect(this.document.system.effects as never),
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

/**
 * Dropdown choices for the shared effect editor: `kindChoices` maps kind ->
 * localized label, derived from the registered `EffectSpec`s' `labelKey`
 * (bead ypbx — a new kind needs NO second edit here); specs registered
 * without a `labelKey` fall back to the raw slug. `testKeyChoices` maps
 * key -> localized label with "" = all tests. `localize` is optional and
 * defaults to `game.i18n.localize`.
 */
export function effectEditorChoices(
	localize: (key: string) => string = (key) => game.i18n.localize(key),
): {
	kindChoices: Record<string, string>;
	testKeyChoices: Record<string, string>;
} {
	const kindChoices: Record<string, string> = {};
	for (const spec of effectKinds.all()) {
		kindChoices[spec.kind] = spec.labelKey ? localize(spec.labelKey) : spec.kind;
	}
	const testKeyChoices: Record<string, string> = {
		"": localize("EFFECTS.ALL_TESTS"),
	};
	for (const [key, labelKey] of characteristicLongLabels.entries()) {
		testKeyChoices[key] = localize(labelKey);
	}
	return { kindChoices, testKeyChoices };
}
