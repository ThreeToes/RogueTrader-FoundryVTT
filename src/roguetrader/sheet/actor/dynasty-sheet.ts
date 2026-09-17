import { Dynasty } from "../../data/actor/dynasty";
import { startingProfitFactorAndShipPoints } from "../../rules/acquisition";
import {
	allowedWarrantColumns,
	getWarrantEntries,
	resolveWarrant,
	WARRANT_ROWS,
	WARRANT_ROW_LABEL_KEYS,
	warrantInRow,
	type WarrantRow,
} from "../../rules/warrant";
import { RtActorSheet } from "../context";

/**
 * Dynasty sheet (bead gjvg): the group's Profit Factor and Ship Points
 * record. Minimal editable fields; Ship Points remaining derives 1:1.
 */
export class DynastySheet extends RtActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "dynasty"],
		position: { width: 520, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollStarting: DynastySheet.#onRollStarting,
			clearWarrant: DynastySheet.#onClearWarrant,
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
		// Shared rich-text partial (bead bef7) renders notes via prose-mirror.
		context.notesHTML = await foundry.applications.ux.TextEditor.enrichHTML(
			system.notes ?? "",
			{ relativeTo: this.document },
		);
		// Ship & Warrant Path section (bead mrsb): the six rows with their
		// current pick, the derived totals and the manual-application notes.
		// Content comes from the `warrant` pack pool; the sheet holds only the
		// row order + labels.
		const picks = system.warrant?.picks ?? {};
		context.warrantPoolEmpty = getWarrantEntries().length === 0;
		context.warrantRows = WARRANT_ROWS.map((row) => ({
			row,
			label: game.i18n.localize(WARRANT_ROW_LABEL_KEYS[row]),
			picked: Boolean(picks[row]),
			options: warrantInRow(row).map((entry) => ({
				key: entry.key,
				name: entry.name,
				selected: picks[row] === entry.key,
			})),
		}));
		const resolved = resolveWarrant(
			WARRANT_ROWS.filter((row) => picks[row]).map((row) => ({
				row,
				key: picks[row],
			})),
		);
		context.warrant = {
			hasPicks: resolved.picks.length > 0,
			complete: resolved.picks.length === WARRANT_ROWS.length,
			shipPoints: resolved.shipPoints,
			profitFactor: resolved.profitFactor,
			renown: resolved.renown,
			notes: resolved.notes,
		};
		return context;
	}

	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		// The warrant row pickers are radio chips (chip-select pattern); a
		// change event cannot reach data-action, so wire them imperatively
		// (AGENT-GUIDE §3 pattern).
		for (const input of this.element?.querySelectorAll<HTMLInputElement>(
			"input[data-warrant-row]",
		) ?? []) {
			if (input.dataset.wired) continue;
			input.dataset.wired = "1";
			input.addEventListener("change", () => {
				if (!input.checked) return;
				this.#setPick(
					input.dataset.warrantRow ?? "",
					input.value,
				).catch((error) =>
					console.error("rogue-trader | dynasty warrant pick failed", error),
				);
			});
		}
	}

	#colOf(picks: Record<string, string>, row: WarrantRow): number | null {
		const key = picks[row];
		if (!key) return null;
		const entry = getWarrantEntries().find(
			(e) => e.row === row && e.key === key,
		);
		return entry ? entry.col : null;
	}

	/**
	 * GM edit: set/clear one row's pick, prune any downstream pick the change
	 * makes unreachable, then re-derive the totals. The APPLIED Profit Factor /
	 * Ship Points follow the path while at least one pick remains; clearing the
	 * whole path leaves the applied values alone (the GM may keep them).
	 */
	async #setPick(rowValue: string, key: string): Promise<void> {
		if (!(WARRANT_ROWS as string[]).includes(rowValue)) return;
		const row = rowValue as WarrantRow;
		const picks: Record<string, string> = {
			...((this.document.system as Dynasty).warrant?.picks ?? {}),
		};
		if (key) picks[row] = key;
		else delete picks[row];
		let prevCol = this.#colOf(picks, row);
		for (
			let i = WARRANT_ROWS.indexOf(row) + 1;
			i < WARRANT_ROWS.length;
			i++
		) {
			const r = WARRANT_ROWS[i];
			if (!picks[r]) {
				prevCol = null;
				continue;
			}
			const entry = getWarrantEntries().find(
				(e) => e.row === r && e.key === picks[r],
			);
			if (!entry || !allowedWarrantColumns(r, prevCol).includes(entry.col)) {
				delete picks[r];
				prevCol = null;
				continue;
			}
			prevCol = entry.col;
		}
		const resolved = resolveWarrant(
			WARRANT_ROWS.filter((r) => picks[r]).map((r) => ({
				row: r,
				key: picks[r],
			})),
		);
		const update: Record<string, unknown> = {
			"system.warrant.picks": picks,
			"system.warrant.shipPoints": resolved.shipPoints,
			"system.warrant.profitFactor": resolved.profitFactor,
		};
		if (resolved.picks.length > 0) {
			update["system.profitFactor"] = resolved.profitFactor;
			update["system.shipPoints.total"] = resolved.shipPoints;
		}
		await (this.document as unknown as {
			update: (data: object) => Promise<unknown>;
		}).update(update);
		this.render({ force: true });
	}

	/** Clear the recorded path (the applied PF/SP are left untouched). */
	static async #onClearWarrant(this: DynastySheet): Promise<void> {
		await (this.document as unknown as {
			update: (data: object) => Promise<unknown>;
		}).update({
			"system.warrant.picks": {},
			"system.warrant.shipPoints": 0,
			"system.warrant.profitFactor": 0,
		});
		this.render({ force: true });
	}

	/**
	 * Stage 5 roll (Core Rulebook Table 1-5, p33): 1d10 for the group's starting
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