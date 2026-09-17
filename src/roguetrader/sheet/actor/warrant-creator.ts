/**
 * Ship & Warrant Path creator (Into the Storm Chapter I, printed pp33-44):
 * a six-step wizard mirroring the planet/ship creators. Each step is one
 * chart row; the options offered come from the private `warrant` pack via
 * rules/warrant.ts (adjacency = |Δcol| <= 1 from the previous pick, so edge
 * options have fewer — or, for Acquisition's Exile/Reward, exactly one —
 * choice below).
 *
 * Finish writes the picks + the summed starting Ship Points / Profit Factor
 * onto a Dynasty actor (create a new one, or update the entry it was opened
 * from — bead d7a9).
 */
import { sheetContext } from "../context";
import { getPackDocuments } from "../pack-resolve";
import {
	allowedWarrantColumns,
	getWarrantEntries,
	isWarrantRow,
	resolveWarrant,
	setWarrantEntries,
	WARRANT_ROWS,
	WARRANT_ROW_LABEL_KEYS,
	type WarrantEntry,
	type WarrantRow,
} from "../../rules/warrant";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** Map a pack document onto the runtime pool entry. */
function toEntry(doc: {
	name?: string;
	system?: {
		key?: string;
		row?: string;
		col?: number;
		description?: string;
		mechanics?: {
			shipPoints?: number;
			profitFactor?: number;
			notes?: unknown[];
		};
	};
}): WarrantEntry | null {
	const s = doc.system ?? {};
	const row = String(s.row ?? "");
	if (!isWarrantRow(row) || !s.key) return null;
	return {
		key: String(s.key),
		row,
		col: Number(s.col ?? 0),
		name: doc.name ?? "",
		description: String(s.description ?? ""),
		mechanics: {
			shipPoints: Number(s.mechanics?.shipPoints ?? 0),
			profitFactor: Number(s.mechanics?.profitFactor ?? 0),
			notes: (s.mechanics?.notes ?? []).map(String),
		},
	};
}

export class WarrantCreator extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-warrant-creator",
		classes: ["rogue-trader", "sheet", "warrant-creator"],
		position: { width: 700, height: 620 },
		window: { title: "WARRANT_CREATOR.TITLE", resizable: true },
		actions: {
			choose: WarrantCreator.#onChoose,
			prev: WarrantCreator.#onPrev,
			next: WarrantCreator.#onNext,
			finish: WarrantCreator.#onFinish,
		},
	};

	name = "";

	/** Wizard step (0..WARRANT_ROWS.length-1). */
	stepIndex = 0;

	/** Row id -> chosen option key. */
	picks: Record<string, string> = {};

	/** Optional existing Dynasty (context-menu entry): update in place. */
	targetActor: foundry.documents.Actor | null = null;

	constructor(
		options: { actor?: foundry.documents.Actor; name?: string } & object = {},
	) {
		super(options as never);
		this.targetActor = options.actor ?? null;
		this.name = options.name ?? this.targetActor?.name ?? "";
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/warrant-creator.hbs",
		},
	};

	/**
	 * Ensure the chart pool is loaded. Normally warmed at ready (sheet/init);
	 * if the wizard opens before the pack resolves, load it here — loudly
	 * empty is a bug, not a feature.
	 */
	async #ensurePool(): Promise<void> {
		if (getWarrantEntries().length > 0) return;
		const docs = (await getPackDocuments("rogue-trader.warrant")) as Array<{
			name?: string;
			type?: string;
			system?: Record<string, unknown>;
		}>;
		setWarrantEntries(
			docs
				.filter((doc) => doc.type === "warrant-option")
				.map((doc) => toEntry(doc as never))
				.filter((entry): entry is WarrantEntry => entry !== null),
		);
	}

	/** Column of a row's current pick (null when unpicked/unknown). */
	#colOf(row: WarrantRow): number | null {
		const key = this.picks[row];
		if (!key) return null;
		const entry = getWarrantEntries().find(
			(e) => e.row === row && e.key === key,
		);
		return entry ? entry.col : null;
	}

	/**
	 * Drop any downstream pick that the new choice makes unreachable, so the
	 * stored path is always legal (same protect-intent as the origin creator).
	 */
	#pruneDownstream(fromRow: WarrantRow): void {
		let prevCol = this.#colOf(fromRow);
		for (let i = WARRANT_ROWS.indexOf(fromRow) + 1; i < WARRANT_ROWS.length; i++) {
			const row = WARRANT_ROWS[i];
			const key = this.picks[row];
			if (!key) {
				prevCol = null;
				continue;
			}
			const entry = getWarrantEntries().find(
				(e) => e.row === row && e.key === key,
			);
			if (!entry || !allowedWarrantColumns(row, prevCol).includes(entry.col)) {
				delete this.picks[row];
				prevCol = null;
				continue;
			}
			prevCol = entry.col;
		}
	}

	async _prepareContext(_options: object = {}) {
		await this.#ensurePool();
		const context = sheetContext(await super._prepareContext(_options as never));
		const index = Math.max(0, Math.min(this.stepIndex, WARRANT_ROWS.length - 1));
		this.stepIndex = index;
		const row = WARRANT_ROWS[index];
		const prevRow = index > 0 ? WARRANT_ROWS[index - 1] : null;
		const prevCol = prevRow ? this.#colOf(prevRow) : null;
		const allowed = allowedWarrantColumns(row, prevCol);
		const options = getWarrantEntries()
			.filter((entry) => entry.row === row && allowed.includes(entry.col))
			.sort((a, b) => a.col - b.col)
			.map((entry) => ({
				key: entry.key,
				name: entry.name,
				description: entry.description,
				shipPoints: entry.mechanics.shipPoints ?? 0,
				profitFactor: entry.mechanics.profitFactor ?? 0,
				notes: entry.mechanics.notes ?? [],
				selected: this.picks[row] === entry.key,
			}));
		const picks = WARRANT_ROWS.filter((r) => this.picks[r]).map((r) => ({
			row: r,
			key: this.picks[r],
		}));
		const resolved = resolveWarrant(picks);
		const pickedKey = this.picks[row];
		const pickedEntry = pickedKey
			? getWarrantEntries().find((e) => e.row === row && e.key === pickedKey)
			: undefined;
		context.name = this.name;
		context.step = {
			row,
			label: game.i18n.localize(WARRANT_ROW_LABEL_KEYS[row]),
			options,
			number: index + 1,
			total: WARRANT_ROWS.length,
			index,
			last: index === WARRANT_ROWS.length - 1,
			picked: Boolean(pickedKey),
			notPicked: !pickedKey,
			// The selected option's detail, shown under the chip row (character
			// creator origin-detail pattern).
			selectedOption: pickedEntry
				? {
						key: pickedEntry.key,
						name: pickedEntry.name,
						description: pickedEntry.description,
						shipPoints: pickedEntry.mechanics.shipPoints ?? 0,
						profitFactor: pickedEntry.mechanics.profitFactor ?? 0,
						notes: pickedEntry.mechanics.notes ?? [],
					}
				: null,
		};
		context.picks = WARRANT_ROWS.filter((r) => this.picks[r]).map((r) => {
			const entry = getWarrantEntries().find(
				(e) => e.row === r && e.key === this.picks[r],
			);
			return {
				row: r,
				label: game.i18n.localize(WARRANT_ROW_LABEL_KEYS[r]),
				name: entry?.name ?? this.picks[r],
			};
		});
		context.totals = {
			shipPoints: resolved.shipPoints,
			profitFactor: resolved.profitFactor,
			renown: resolved.renown,
			notes: resolved.notes,
			complete: resolved.picks.length === WARRANT_ROWS.length,
		};
		return context;
	}

	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		const input = this.element?.querySelector<HTMLInputElement>(
			'input[name="warrant-name"]',
		);
		if (input && !input.dataset.wired) {
			input.dataset.wired = "1";
			input.addEventListener("input", () => {
				this.name = input.value;
			});
		}
	}

	static async #onChoose(
		this: WarrantCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.dataset.row ?? "";
		const key = target.dataset.key ?? "";
		if (!isWarrantRow(row)) return;
		const picks = { ...this.picks };
		if (key) {
			picks[row] = key;
		} else {
			// Clicking the selected chip clears it; the chain is broken, so any
			// downstream pick loses its anchor and is cleared too.
			delete picks[row];
			for (let i = WARRANT_ROWS.indexOf(row) + 1; i < WARRANT_ROWS.length; i++) {
				delete picks[WARRANT_ROWS[i]];
			}
		}
		this.picks = picks;
		if (key) this.#pruneDownstream(row);
		this.render({ force: true });
	}

	static async #onPrev(this: WarrantCreator): Promise<void> {
		this.stepIndex = Math.max(0, this.stepIndex - 1);
		this.render({ force: true });
	}

	static async #onNext(this: WarrantCreator): Promise<void> {
		this.stepIndex = Math.min(this.stepIndex + 1, WARRANT_ROWS.length - 1);
		this.render({ force: true });
	}

	/** Create/update the Dynasty actor with the picks + derived totals. */
	static async #onFinish(this: WarrantCreator): Promise<void> {
		const picks = WARRANT_ROWS.filter((r) => this.picks[r]).map((r) => ({
			row: r,
			key: this.picks[r],
		}));
		const resolved = resolveWarrant(picks);
		if (!this.name && !this.targetActor) {
			this.name = game.i18n.localize("WARRANT_CREATOR.DEFAULT_NAME");
		}
		if (this.targetActor) {
			const target = this.targetActor as unknown as {
				name?: string;
				update: (data: object) => Promise<unknown>;
				sheet?: { render: (options?: object) => unknown };
			};
			await target.update({
				name: this.name || target.name,
				"system.warrant.picks": this.picks,
				"system.warrant.shipPoints": resolved.shipPoints,
				"system.warrant.profitFactor": resolved.profitFactor,
				"system.profitFactor": resolved.profitFactor,
				"system.shipPoints.total": resolved.shipPoints,
			} as never);
			this.close();
			target.sheet?.render({});
			return;
		}
		const actor = (await foundry.documents.Actor.create({
			name: this.name || game.i18n.localize("WARRANT_CREATOR.DEFAULT_NAME"),
			type: "dynasty",
			system: {
				warrant: {
					picks: this.picks,
					shipPoints: resolved.shipPoints,
					profitFactor: resolved.profitFactor,
				},
				profitFactor: resolved.profitFactor,
				shipPoints: { total: resolved.shipPoints, spent: 0 },
			},
		} as never)) as unknown as {
			sheet?: { render: (options?: object) => unknown };
		} | null;
		if (!actor) return;
		this.close();
		actor.sheet?.render({});
	}
}
