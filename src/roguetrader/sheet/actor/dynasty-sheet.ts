import { Dynasty } from "../../data/actor/dynasty";
import { startingProfitFactorAndShipPoints } from "../../rules/acquisition";
import {
	getWarrantEntries,
	pruneWarrantPicks,
	resolveWarrant,
	WARRANT_ROWS,
	WARRANT_ROW_LABEL_KEYS,
	warrantInRow,
	type WarrantRow,
} from "../../rules/warrant";
import { warrantChoiceViews } from "./warrant-views";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import { sheetContext } from "../context";
import { enrichText } from "../rich-text";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Dynasty sheet (bead gjvg): the group's Profit Factor and Ship Points
 * record. Minimal editable fields; Ship Points remaining derives 1:1.
 *
 * Tabbed record (bead twtq): tab 1 keeps the PF/SP fields, the starting roll,
 * the GM's Warrant pickers (owners/GM only) and the notes; tabs 2-7 are one
 * READ-ONLY view per Ship & Warrant Path chart row showing the picked
 * entry's flavour text and mechanics — the picking wizard stays the
 * WarrantCreator, this sheet is the record.
 *
 * Extends the Foundry bases directly and widens the context locally with
 * `sheetContext` (bead e2ge): a shared Rt*Sheet base cannot be made
 * type-correct without making tsc non-terminating — see sheet/context.ts.
 */
const CHOICE_TAB_TEMPLATE =
	"systems/rogue-trader/template/sheet/actor/tabs/dynasty-choice.hbs";

export class DynastySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "dynasty"],
		position: { width: 520, height: "auto" as const },
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
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		record: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/dynasty-record.hbs",
		},
		// One PART per choice tab, all rendering the SAME shared template
		// parameterised in _preparePartContext — never six hand-copied files
		// (bead twtq).
		...Object.fromEntries(
			WARRANT_ROWS.map((row) => [row, { template: CHOICE_TAB_TEMPLATE }]),
		),
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "record", group: "primary", label: "DYNASTY.TAB_RECORD", cssClass: "" },
				// Tab labels reuse the chart-row step labels (WARRANT.ROW_*).
				...WARRANT_ROWS.map((row) => ({
					id: row,
					group: "primary" as const,
					label: WARRANT_ROW_LABEL_KEYS[row],
					cssClass: "",
				})),
			],
			initial: "record",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("DYNASTY.HEADER")}: ${this.document.name}`;
	}

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		const system = this.document.system as Dynasty;
		context.profitFactor = system.profitFactor;
		context.shipPoints = system.shipPoints;
		context.shipPointsRemaining = system.shipPointsRemaining;
		// Shared rich-text partial (bead bef7) renders notes via prose-mirror.
		context.notesHTML = await enrichText(system.notes ?? "", this.document);
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
		// Per-row choice views (bead twtq): one view per chart row, resolved
		// against the pool by the shared pure helper; each resolved view's
		// verbatim description is enriched here (async, owner-only secrets) —
		// the choice tabs show the flavour text of THEIR choice.
		const choices = warrantChoiceViews(picks, getWarrantEntries());
		const ownerSecrets = this.document.isOwner;
		for (const view of choices) {
			if (!view.resolved) continue;
			view.descriptionHTML = await enrichText(view.description, this.document, {
				secrets: ownerSecrets,
			});
		}
		context.warrantChoices = choices;
		context.warrantChoicesByRow = Object.fromEntries(
			choices.map((view) => [view.row, view]),
		);
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

	/**
	 * Choice-tab parameterisation (bead twtq): all six choice tabs render the
	 * ONE shared dynasty-choice.hbs; each of those parts' context gains the
	 * row's view (`warrantTab`), the tab id (`rowId`, the data-tab attribute)
	 * and the tab's active class (`rowTabClass`, mirrors the core
	 * `tabs.<id>.cssClass` wiring the record template uses).
	 */
	// The override widens types off the Foundry RenderContext graph (same
	// reason as sheetContext in sheet/context.ts): a typed signature makes
	// tsc non-terminating.
	protected override async _preparePartContext(
		partId: string,
		context: unknown,
	): Promise<any> {
		const base = await super._preparePartContext(
			partId as never,
			context as never,
			{} as never,
		);
		if (!(WARRANT_ROWS as string[]).includes(partId)) return base;
		const tabs = (base as { tabs?: Record<string, { cssClass?: string }> })
			.tabs ?? {};
		const choice = base as {
			warrantChoicesByRow?: Record<string, unknown>;
		};
		return {
			...base,
			warrantTab: choice.warrantChoicesByRow?.[partId],
			rowId: partId,
			rowTabClass: tabs[partId]?.cssClass ?? "",
		};
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

	/**
	 * GM edit: set/clear one row's pick, prune any downstream pick the change
	 * makes unreachable (shared pruneWarrantPicks, bead 6yz8), then re-derive
	 * the totals. The APPLIED Profit Factor / Ship Points follow the path while
	 * at least one pick remains; clearing the whole path leaves the applied
	 * values alone (the GM may keep them).
	 */
	async #setPick(rowValue: string, key: string): Promise<void> {
		if (!(WARRANT_ROWS as string[]).includes(rowValue)) return;
		const row = rowValue as WarrantRow;
		const picks: Record<string, string> = {
			...((this.document.system as Dynasty).warrant?.picks ?? {}),
		};
		if (key) picks[row] = key;
		else delete picks[row];
		const pruned = pruneWarrantPicks(picks, row);
		const resolved = resolveWarrant(
			WARRANT_ROWS.filter((r) => pruned[r]).map((r) => ({
				row: r,
				key: pruned[r],
			})),
		);
		const update: Record<string, unknown> = {
			"system.warrant.picks": pruned,
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
		const total = (await getPorts().dice.roll("1d10")).total ?? 1;
		const result = startingProfitFactorAndShipPoints(total);
		await (this.document as unknown as {
			update: (data: object) => Promise<unknown>;
		}).update({
			system: {
				profitFactor: result.profitFactor,
				shipPoints: { total: result.shipPoints },
			},
		});
		getPorts().notify.info("DYNASTY.ROLLED", {
			roll: String(total),
			pf: String(result.profitFactor),
			sp: String(result.shipPoints),
		});
		this.render({ force: true });
	}
}