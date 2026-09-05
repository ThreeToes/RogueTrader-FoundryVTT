import { Dynasty } from "../../data/actor/dynasty";
import { startingProfitFactorAndShipPoints } from "../../rules/acquisition";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Dynasty sheet (bead gjvg): the group's Profit Factor and Ship Points
 * record. Minimal editable fields; Ship Points remaining derives 1:1.
 */
export class DynastySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "dynasty"],
		position: { width: 480, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollStarting: DynastySheet.#onRollStarting,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/dynasty-header.hbs",
		},
		form: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/dynasty.hbs",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("DYNASTY.HEADER")}: ${this.document.name}`;
	}

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as Dynasty;
		context.profitFactor = system.profitFactor;
		context.shipPoints = system.shipPoints;
		context.shipPointsRemaining = system.shipPointsRemaining;
		return context;
	}

	/**
	 * Stage 5 roll (rt_core Table 1-5, p33): 1d10 for the group's starting
	 * Profit Factor and Ship Points. GM/group-level — done here on the
	 * dynasty document, not in the character creator (owner redesign).
	 */
	static async #onRollStarting(this: DynastySheet): Promise<void> {
		const roll = new foundry.dice.Roll("1d10");
		await roll.evaluate();
		const result = startingProfitFactorAndShipPoints(roll.total ?? 1);
		await (this.document as unknown as {
			update: (data: object) => Promise<unknown>;
		}).update({
			system: {
				profitFactor: result.profitFactor,
				shipPoints: { total: result.shipPoints },
			},
		});
		ui.notifications?.info(
			game.i18n!.format("DYNASTY.ROLLED", {
				roll: String(roll.total ?? 1),
				pf: String(result.profitFactor),
				sp: String(result.shipPoints),
			}),
		);
		this.render({ force: true });
	}
}