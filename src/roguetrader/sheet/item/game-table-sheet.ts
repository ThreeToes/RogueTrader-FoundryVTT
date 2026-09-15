import { effectActions } from "./effect-actions";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Game table sheet (owner ask, planet actors): single-section read-mostly
 * sheet for the `game-table` type — the gametables compendium rows (SOI
 * world/planetside generators, test difficulties, movement ladders, vehicle
 * criticals). Shows the kind, raw roll range and any stat-block columns the
 * row carries, then the full result prose.
 */
export class GameTableSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "game-table"],
		position: { width: 520, height: "auto" },
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
				"systems/rogue-trader/template/sheet/item/parts/game-table-content.hbs",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const sys = this.document.system as unknown as Record<string, unknown>;
		// Optional stat-block columns, shown only when authored.
		const columns = (
			[
				["roll", "GAME_TABLE.ROLL"],
				["rating", "GAME_TABLE.RATING"],
				["difficulty", "GAME_TABLE.DIFFICULTY"],
				["modifier", "GAME_TABLE.MODIFIER"],
				["complexity", "GAME_TABLE.COMPLEXITY"],
				["time", "GAME_TABLE.TIME"],
				["degrees", "GAME_TABLE.DEGREES"],
				["threshold", "GAME_TABLE.THRESHOLD"],
				["availability", "GAME_TABLE.AVAILABILITY"],
				["zone", "GAME_TABLE.ZONE"],
				["hullSection", "GAME_TABLE.HULL_SECTION"],
				["xp", "GAME_TABLE.XP"],
				["charm", "GAME_TABLE.CHARM"],
				["command", "GAME_TABLE.COMMAND"],
				["deceive", "GAME_TABLE.DECIEVE"],
				["intimidate", "GAME_TABLE.INTIMIDATE"],
				["size", "GAME_TABLE.SIZE"],
				["concealment", "GAME_TABLE.CONCEALMENT"],
				["movement", "GAME_TABLE.MOVEMENT"],
			] as Array<[string, string]>
		)
			.map(([key, labelKey]) => ({
				key,
				label: game.i18n.localize(labelKey),
				value: String(sys[key] ?? ""),
			}))
			.filter((c) => c.value !== "" && c.value !== "0");
		context.columns = columns;
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				String(sys.description ?? ""),
				{ secrets: this.document.isOwner, relativeTo: this.document },
			);
		return context;
	}
}