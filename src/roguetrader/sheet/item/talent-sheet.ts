import { talentCategories } from "../../registry";
import { findPackTalentDoc } from "../actor/grant-helpers";
import { isBareTalent, talentBackfillPatch } from "../../rules/talent-backfill";
import { effectActions, effectEditorChoices } from "./effect-actions";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Single-section talent sheet (no tabs): header + data + description in one
 * scrollable element. All fields degrade to read-only HTML when the sheet is
 * not editable ({{#if editable}} in the templates).
 */
export class TalentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "talent"],
		position: { width: 500, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: { ...effectActions },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/talent-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		// Bare legacy heal (bead oaaz): pre-meh0 creator talents carry no pack
		// data — heal once on render (AGENT-GUIDE §3 render-time backfill;
		// hooks are never awaited). Guarded by isBareTalent so manual/homebrew
		// talents are never clobbered; the pack match is by name,
		// case-insensitive. The heal updates in place; this render still shows
		// the (pre-heal) data, the next one shows the healed fields.
		const doc = this.document as unknown as {
			system: Record<string, unknown>;
			name?: string;
			update: (data: object) => Promise<void>;
		};
		if (isBareTalent(doc.system as never) && doc.name) {
			const packDoc = await findPackTalentDoc(doc.name);
			if (packDoc) {
				const patch = talentBackfillPatch(
					packDoc as unknown as Parameters<typeof talentBackfillPatch>[0],
				);
				if (Object.keys(patch).length > 0) {
					console.log(
						`rogue-trader | backfilling bare talent "${doc.name}" from the talents pack (bead oaaz)`,
					);
					await doc.update({ system: patch });
				}
			} else {
				console.warn(
					`rogue-trader | bare talent "${doc.name}" has no match in rogue-trader.talents — leaving as-is`,
				);
			}
		}
		context.categoryChoices = Object.fromEntries(talentCategories.entries());
		// Read-only display label for the category select.
		context.categoryLabel = game.i18n.localize(
			talentCategories.choices[
				this.document.system.category
			] as string,
		);
		// Effect editor choices (bead bpd): localized kind labels + test keys.
		Object.assign(context, effectEditorChoices((key) => game.i18n.localize(key)));
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				this.document.system.description,
				{
					secrets: this.document.isOwner,
					relativeTo: this.document,
				},
			);
		return context;
	}
}