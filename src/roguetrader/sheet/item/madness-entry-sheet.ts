const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { effectActions, effectEditorChoices } from "./effect-actions";
import { itemDescriptionHTML } from "../rich-text";
import { itemSheetOptions } from "../sheet-options";

/** MadnessEntry kind -> i18n key (data/item/madness.ts schema comment). */
const KIND_LABEL_KEYS: Record<string, string> = {
	disorder: "MADNESS.KIND_DISORDER",
	malignancy: "MADNESS.KIND_MALIGNANCY",
	"insanity-track": "MADNESS.KIND_INSANITY_TRACK",
	"corruption-track": "MADNESS.KIND_CORRUPTION_TRACK",
	trauma: "MADNESS.KIND_TRAUMA",
	note: "MADNESS.KIND_NOTE",
	// The afflictions pack's reference tables are madnessentry docs too
	// (madness.yaml rows the packer types wholesale): the fear difficulties,
	// psychic phenomena, perils of the warp and shock results. Without these
	// the sheet falls back to the raw kind on ~60 compendium rows.
	"fear-difficulty": "MADNESS.KIND_FEAR_DIFFICULTY",
	perils: "MADNESS.KIND_PERILS",
	phenomena: "MADNESS.KIND_PHENOMENA",
	"shock-table": "MADNESS.KIND_SHOCK_TABLE",
};

/**
 * Madness affliction sheet (bead fgm1): read-first reference sheet for the
 * `madnessentry` type — disorders, malignancies and the track/trauma rows the
 * insanity/corruption tracks read (Core Rulebook pp296-300). Replaces the
 * GearSheet, which showed none of the affliction's own data.
 *
 * Presents the kind, the d100 roll band when the entry carries one (track
 * rows and malignancies), the Degree + test modifier the track reads
 * (`MADNESS.TRAUMA_MODIFIER`/`MALIGNANCY_MODIFIER` vocabulary), the severity
 * a acquired copy was gained at (epic nt8k), the mechanical effects via the
 * shared editor, and the verbatim book prose. Compendium templates are
 * read-only; owned copies keep the standard editable-aware branch.
 */
export class MadnessEntrySheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "madness-entry",
		width: 560,
		height: "auto",
		actions: { ...effectActions },
	});

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/madness-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const localize = (key: string) => game.i18n.localize(key);
		const sys = this.document.system as unknown as {
			kind?: string;
			rollMin?: number;
			rollMax?: number;
			degree?: string;
			modifier?: number;
			acquiredSeverity?: string;
		};
		const kind = String(sys.kind ?? "");
		context.kindLabel = localize(KIND_LABEL_KEYS[kind] ?? kind);
		const rollMin = Number(sys.rollMin ?? 0);
		const rollMax = Number(sys.rollMax ?? 999);
		context.rollMin = rollMin;
		context.rollMax = rollMax;
		// Only the track rows and malignancies carry a band; the schema
		// defaults (0-999) are not printed data.
		context.showRollBand = rollMin !== 0 || rollMax !== 999;
		context.degree = String(sys.degree ?? "");
		context.modifier = Number(sys.modifier ?? 0);
		context.showDegree = context.degree !== "" || context.modifier !== 0;
		context.acquiredSeverity = String(sys.acquiredSeverity ?? "");
		// Shared effect editor's dropdown choices (kind/test key labels).
		Object.assign(context, effectEditorChoices());
		context.descriptionHTML = await itemDescriptionHTML(this.document);
		return context;
	}
}