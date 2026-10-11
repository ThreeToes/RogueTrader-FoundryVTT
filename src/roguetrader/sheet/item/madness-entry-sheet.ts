const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

import { effectActions } from "./effect-actions";
import { itemDataContext, sheetContext } from "../context";
import { itemSheetOptions } from "../sheet-options";
import { madnessEntryKinds } from "../../registry";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

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
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		content: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/madness-content.hbs`,
		},
	};

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
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
		// Kind labels (bead b76m): the madnessEntryKinds registry, not a
		// sheet-local map — modules register extra kinds at init
		// (CONFIG.ROGUE_TRADER.madnessEntryKinds.register(...)) and the sheet
		// picks them up; unknown kinds fall back to the raw value.
		context.kindLabel = localize(madnessEntryKinds.get(kind) ?? kind);
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
		// Item data keys (bead apxq): effect editor choices (bead bpd, localized
		// kind labels + test keys) + the enriched description prose.
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}
