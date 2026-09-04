import { careers } from "../../registry";
import type { CareerRank } from "../../data/item/career";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Display row for one rank's advance list. */
interface AdvanceRow {
	label: string;
	typeLabel: string;
	cost: number;
	multiplier: number;
	prerequisites: string;
}

/**
 * Single-section career sheet (no tabs), mirroring the talent sheet: header +
 * content in one scrollable element, all fields degrading to read-only HTML
 * when the sheet is not editable (bead 2n5). Rank/advance tables are pack
 * data and display-only in the sheet; the editable fields are the prose
 * description, short description (header), key, source page and aptitudes.
 */
export class CareerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "career"],
		position: { width: 540, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		content: {
			template:
				"systems/rogue-trader/template/sheet/item/parts/career-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as CareerLike;
		context.careerChoices = Object.fromEntries(careers.entries());
		context.aptitudesText = system.aptitudes?.join(", ") ?? "";
		context.charAdvanceRows = Object.entries(
			system.characteristicAdvances ?? {},
		).map(([char, costs]) => ({
			char,
			costs: `${costs.simple} / ${costs.intermediate} / ${costs.trained} / ${costs.expert}`,
		}));
		context.rankRows = [...(system.ranks ?? [])]
			.sort((a, b) => a.rank - b.rank)
			.map((rank) => ({
				rank: rank.rank,
				xpLevel: rank.xpLevel,
				advances: rank.advances.map(
					(adv): AdvanceRow => ({
						label: adv.key || adv.name || "—",
						typeLabel: game.i18n.localize(
							adv.type === "talent"
								? "CAREER.TYPE_TALENT"
								: "CAREER.TYPE_SKILL",
						),
						cost: adv.cost,
						multiplier: adv.multiplier,
						prerequisites: adv.prerequisites?.join(", ") ?? "",
					}),
				),
			}));
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				system.description,
				{
					secrets: this.document.isOwner,
					relativeTo: this.document,
				},
			);
		return context;
	}
}

interface CareerLike {
	description?: string;
	aptitudes?: string[];
	characteristicAdvances?: Record<
		string,
		{ simple: number; intermediate: number; trained: number; expert: number }
	>;
	ranks?: CareerRank[];
}