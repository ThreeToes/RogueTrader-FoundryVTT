import { sumModifiers } from "../../../rules-engine/src/index";
import type { Modifier } from "../../../rules-engine/src/modifier";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * One rung of the difficulty ladder, as injectable DATA (bead p7jv): the
 * dialog itself is system-neutral — the system's composition point supplies
 * its own ladder (RT's lives in the shim at rules/test-dialog.ts).
 */
export interface DifficultyStep {
	key: string;
	value: number;
}

/**
 * The branding seam (bead p7jv): the template path and window id/classes that
 * make the dialog LOOK like a given system. Foundry resolves PARTS and
 * DEFAULT_OPTIONS statically, so these live on a static the system subclass
 * overrides (see rules/test-dialog.ts for the RT branding).
 */
export interface TestDialogBranding {
	/** Handlebars template rendered as the dialog body. */
	template: string;
	/** ApplicationV2 window id. */
	windowId: string;
	/** ApplicationV2 window classes (first is conventionally the system slug). */
	windowClasses: string[];
}

export interface TestDialogAttackContext {
	/** Ranged weapon: show the fire-mode select (single/burst/full). */
	ranged: boolean;
	/** Melee weapon: show the charge checkbox (talent conditions gate on it). */
	melee: boolean;
}

export interface TestDialogRequest {
	/** Window title. */
	title: string;
	/** Unmodified target (characteristic / skill value). */
	baseTarget: number;
	/** Pre-collected contributor modifiers (shown as fixed rows). */
	contributors?: Modifier[];
	/** Bead hyv: attack-context selectors (fire mode, aim, charge). */
	attackContext?: TestDialogAttackContext;
	/**
	 * Guarded-effect condition keys in play for this test (bead xu83), e.g.
	 * ["brightlight", "poison"]. Rendered as pre-roll toggles so a guarded
	 * affliction/talent modifier is visible and optional rather than silent.
	 */
	conditions?: string[];
	/**
	 * Label resolver for the guarded-effect condition keys (bead 8ycd registry
	 * seam): the dialog no longer reads the RT talentConditions registry
	 * directly — the system caller supplies the lookup, the dialog stays
	 * registry-neutral. Defaults to the raw key.
	 */
	conditionLabel?: (key: string) => string;
	/**
	 * Re-collect the fixed contributor rows for the current condition flags,
	 * so the live target preview reflects a toggled guard. Without it the
	 * toggles still reach the roll via `flags` (roll-system re-collects).
	 */
	collectForConditions?: (flags: Record<string, boolean>) => Modifier[];
	/**
	 * The system's difficulty ladder (bead p7jv): injectable data, rendered in
	 * the order given. Empty by default (no difficulty select).
	 */
	difficultyLadder?: DifficultyStep[];
	/**
	 * i18n key prefix for difficulty labels (bead p7jv): each step renders
	 * `localize(<prefix><KEY>)` and a selected custom value renders
	 * `localize(<prefix>CUSTOM)`. Empty by default (raw keys).
	 */
	difficultyLabelPrefix?: string;
}

export interface TestDialogAttackSelection {
	/** Ranged fire mode; undefined = standard/single. */
	fireMode?: "single" | "burst" | "full";
	/** Aim action taken (half = +10, full = +20, p237). */
	aimed?: boolean;
	/** Aim was a Full Action (+20 instead of +10). */
	aimFull?: boolean;
	/** Charge action flag (melee; Berserk Charge replaces the base +10). */
	flags?: Record<string, boolean>;
}

export interface TestDialogResult {
	/** Contributor + custom modifiers to feed the funnel. */
	modifiers: Modifier[];
	/** Attack-context selection (bead hyv), when applicable. */
	attack?: TestDialogAttackSelection;
	/** Enabled guarded-effect condition flags (bead xu83). */
	flags?: Record<string, boolean>;
}

/**
 * Shared roll dialog for every test type (characteristic, skill, attack,
 * vehicle-handling): shows collected contributor modifiers as fixed rows, an
 * editable custom-modifier list with add/remove, a live clamped target
 * preview, and roll/cancel controls.
 *
 * System-neutral (bead p7jv): branding (template path, window id/classes) is
 * a static override, and the difficulty ladder + its i18n key prefix are
 * request data merged from `static defaults`. A system subclasses this class,
 * sets `branding` and `defaults`, and keeps the machinery here untouched.
 */
export class TestDialogBase extends HandlebarsApplicationMixin(ApplicationV2) {
	/** The system look: template path + window id/classes. Override per system. */
	static branding: TestDialogBranding = {
		template: "",
		windowId: "test-dialog",
		windowClasses: ["dialog", "test-dialog-app"],
	};

	/**
	 * Request defaults the system composition point injects (ladder, i18n
	 * prefix). Per-call request fields win over these.
	 */
	static defaults: Partial<TestDialogRequest> = {};

	static get DEFAULT_OPTIONS() {
		const branding = this.branding;
		return {
			id: branding.windowId,
			classes: branding.windowClasses,
			tag: "div",
			window: {
				minWidth: 440,
				minHeight: 260,
				resizable: true,
			},
			position: { width: 500, height: "auto" as const },
			actions: {
				addModifier: TestDialogBase.#onAdd,
				removeModifier: TestDialogBase.#onRemove,
				updateModifier: TestDialogBase.#onUpdate,
				updateDifficulty: TestDialogBase.#onDifficulty,
				roll: TestDialogBase.#onRoll,
				cancel: TestDialogBase.#onCancel,
			},
		};
	}

	static get PARTS() {
		return {
			form: {
				template: this.branding.template,
			},
		};
	}

	#baseTarget: number;
	#contributors: Modifier[];
	#conditions: string[];
	// Guard-toggle state survives a rerender (add/remove custom modifier),
	// which recreates the checkboxes from scratch.
	#conditionState: Record<string, boolean> = {};
	#collectForConditions:
		| ((flags: Record<string, boolean>) => Modifier[])
		| null;
	#conditionLabel: ((key: string) => string) | null;
	#ladder: DifficultyStep[];
	#labelPrefix: string;
	#custom: modifiersRow[];	// Bead z132: the modifiers expander persists its open state across
	// rerenders (add/remove custom rows recreates the DOM); collapsed default.
	#modifiersOpen = false;
	// Bead wqt3: selected difficulty modifier (null = no selection).
	// Kept for rerender persistence; the authoritative value at roll/preview
	// time is the state itself (button chips fire clicks reliably — the old
	// DOM-read existed for the select's unreliable change events).
	#difficultyValue: number | null = null;
	#attackContext: TestDialogAttackContext | null;
	// Bead hyv: attack-context selection state (read at roll time).
	#attack: TestDialogAttackSelection = {};
	#resolve: ((result: TestDialogResult | null) => void) | null = null;

	constructor(options: { request: TestDialogRequest }) {
		const request = options.request;
		// Merge the request title into the window options so the dialog window
		// shows the test name instead of the default (bead uc5).
		super({ ...options, window: { title: request.title } });
		this.#baseTarget = request.baseTarget;
		this.#attackContext = request.attackContext ?? null;
		this.#conditions = request.conditions ?? [];
		this.#collectForConditions = request.collectForConditions ?? null;
		this.#conditionLabel = request.conditionLabel ?? null;
		this.#ladder = request.difficultyLadder ?? [];
		this.#labelPrefix = request.difficultyLabelPrefix ?? "";
		// Full modifiers kept so ids survive #collectModifiers — postTest's
		// funnel merge then dedupes these against a fresh collection instead
		// of double-counting (bead bpd follow-up).
		this.#contributors = request.contributors ?? [];
		this.#custom = [];
	}

	/** Show the dialog; resolves null on cancel/close. */
	static async show(
		this: typeof TestDialogBase,
		request: TestDialogRequest,
	): Promise<TestDialogResult | null> {
		// The system composition point's defaults fill the request, and a
		// per-call field wins (bead p7jv).
		const merged = { ...this.defaults, ...request };
		const dialog = new this({ request: merged });
		return await dialog.#promise();
	}

	#promise(): Promise<TestDialogResult | null> {
		return new Promise<TestDialogResult | null>((resolve) => {
			this.#resolve = resolve;
			this.render({ force: true });
		});
	}

	#finish(result: TestDialogResult | null): void {
		this.#resolve?.(result);
		this.#resolve = null;
		// ApplicationV2#close has no "force" option (ClosingOptions are
		// animate/closeKey/submitted) and always closes unconditionally — the
		// old {force: true} argument was silently ignored at runtime.
		super.close();
	}

	/**
	 * Current difficulty value: the chip state is authoritative — button
	 * chips have no native input to read, and click delegation (unlike the
	 * old select's change events) fires reliably, so the state is always
	 * current. The DOM is only a fallback for a checked button at roll time.
	 */
	#currentDifficulty(): number | null {
		const checked = this.element?.querySelector<HTMLButtonElement>(
			"button[data-difficulty].checked",
		);
		if (!checked) return this.#difficultyValue;
		const raw = checked.dataset.value ?? "";
		return raw === "" ? null : Number(raw);
	}

	/** Current sum: fixed contributors + difficulty + custom rows. */
	#totalModifier(): number {
		return sumModifiers(this.#collectModifiers());
	}

	/** Checked guarded-effect condition flags (authoritative at roll time). */
	#conditionFlags(): Record<string, boolean> {
		const flags: Record<string, boolean> = {};
		const boxes = this.element?.querySelectorAll<HTMLInputElement>(
			"[data-condition]",
		);
		for (const box of boxes ?? []) {
			const key = box.dataset.condition ?? "";
			if (key && box.checked) flags[key] = true;
		}
		return flags;
	}

	/**
	 * Fixed rows for the current guard selection: the request's contributors,
	 * or (when a toggle is on and a re-collector was supplied) a fresh
	 * collection that includes the now-unguarded effects.
	 */
	#fixedContributors(): Modifier[] {
		const flags = this.#conditionFlags();
		if (this.#collectForConditions && Object.keys(flags).length > 0) {
			return this.#collectForConditions(flags);
		}
		return this.#contributors;
	}

	/** Difficulty i18n key for a selected value: step key, else "CUSTOM". */
	#difficultyKey(value: number): string {
		const step = this.#ladder.find((d) => d.value === value);
		return `${this.#labelPrefix}${step?.key ?? "CUSTOM"}`;
	}

	/** Build the Modifier[] payload from fixed + difficulty + custom rows. */
	#collectModifiers(): Modifier[] {
		const rows = this.element?.querySelectorAll<HTMLElement>(
			".modifier-row.custom",
		);
		const out: Modifier[] = this.#fixedContributors().map((m) => ({ ...m }));
		// Bead wqt3: append the difficulty as a labelled, visible contributor
		// (additive with custom modifiers). Read from the DOM at roll time so
		// it always reaches the funnel (bug: state-only tracking meant the
		// selection was never piped into the roll).
		const difficulty = this.#currentDifficulty();
		if (difficulty !== null) {
			out.push({
				id: "difficulty",
				source: { type: "dialog" as const, label: "ROLL.DIALOG" },
				label: game.i18n!.localize(this.#difficultyKey(difficulty)),
				value: difficulty,
			});
		}
		if (!rows) return out;
		rows.forEach((row) => {
			const label =
				row.querySelector<HTMLInputElement>(".modifier-label")?.value ?? "";
			const value =
				Number(row.querySelector<HTMLInputElement>(".modifier-value")?.value) ||
				0;
			if (label || value !== 0) {
				out.push({
					id: `custom:${out.length}`,
					source: { type: "dialog" as const, label: "ROLL.DIALOG" },
					label: label || "—",
					value,
				});
			}
		});
		return out;
	}

	#updatePreview(): void {
		const root = this.element;
		if (!root) return;
		const total = this.#totalModifier();
		const target = Math.min(
			100,
			Math.max(1, this.#baseTarget + total),
		);
		const setText = (selector: string, text: string): void => {
			const el = root.querySelector<HTMLElement>(selector);
			if (el) el.textContent = text;
		};
		// Bead z132: the three-stat strip — base, live modifier total, and the
		// clamped final target, all driven by the same collection as the roll.
		setText("[data-base]", String(this.#baseTarget));
		setText("[data-total]", total > 0 ? `+${total}` : String(total));
		setText("[data-preview]", String(target));
	}

	override async _prepareContext(
		options: Parameters<InstanceType<typeof ApplicationV2>["_prepareContext"]>[0],
	) {
		const context = (await super._prepareContext(options)) as Record<
			string,
			unknown
		>;
		context.baseTarget = this.#baseTarget;
		context.contributors = this.#fixedContributors().map((m) => ({
			label: m.label,
			value: m.value,
			sourceLabel: m.source.label,
		}));
		context.conditions = this.#conditions.map((key) => ({
			key,
			label: game.i18n!.localize(this.#conditionLabel?.(key) ?? key),
			checked: this.#conditionState[key] ?? false,
		}));
		context.customModifiers = this.#custom;
		context.attackContext = this.#attackContext;
		context.modifiersOpen = this.#modifiersOpen;
		context.difficulty = this.#ladder.map((d) => ({
			key: d.key,
			value: d.value,
			label: game.i18n!.localize(`${this.#labelPrefix}${d.key}`),
		}));
		context.difficultyValue = this.#difficultyValue;
		// Bead z132: the "no modifier" ladder chip needs its own checked flag —
		// difficultyValue 0 (Challenging) is a real selection and must not read
		// as "none".
		context.difficultyNone = this.#difficultyValue === null;
		context.previewTarget = Math.min(
			100,
			Math.max(1, this.#baseTarget + this.#totalModifier()),
		);
		return context;
	}

	override async _onRender(
		context: Parameters<InstanceType<typeof ApplicationV2>["_onRender"]>[0],
		options: Parameters<InstanceType<typeof ApplicationV2>["_onRender"]>[1],
	): Promise<void> {
		await super._onRender(context, options);
		this.#updatePreview();
		// Foundry action delegation is unreliable on change events (see the
		// condition toggles); listen natively so a guard toggle refreshes the
		// preview immediately. The roll reads the boxes from the DOM anyway.
		for (const box of this.element?.querySelectorAll<HTMLInputElement>(
			"[data-condition]",
		) ?? []) {
			box.addEventListener("change", () => {
				this.#conditionState[box.dataset.condition ?? ""] = box.checked;
				this.#updatePreview();
			});
		}
		// Bead z132: persist the modifiers expander's open state across
		// rerenders so adding a custom row does not collapse it again.
		const expander = this.element?.querySelector<HTMLDetailsElement>(
			"[data-modifiers]",
		);
		expander?.addEventListener("toggle", () => {
			this.#modifiersOpen = expander.open;
		});
	}

	static async #onAdd(this: TestDialogBase): Promise<void> {
		this.#custom.push({ label: "", value: 10 });
		// Bead z132: adding a row implies editing it — open the expander.
		this.#modifiersOpen = true;
		await this.render({ force: true });
	}

	static async #onRemove(
		this: TestDialogBase,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index);
		if (Number.isInteger(index)) this.#custom.splice(index, 1);
		await this.render({ force: true });
	}

	/** Live-label update without rerender; values picked up at roll time. */
	static #onUpdate(this: TestDialogBase): void {
		this.#updatePreview();
	}

	/**
	 * Bead wqt3: difficulty selection changed — update state + preview.
	 * Bead z132: the ladder is a BUTTON chip group (no native input to leak
	 * through); the clicked chip carries data-value, and the group's visual
	 * state is synced here so no rerender is needed.
	 */
	static #onDifficulty(
		this: TestDialogBase,
		_event: unknown,
		target: HTMLElement,
	): void {
		const raw = target.dataset.value ?? "";
		this.#difficultyValue = raw === "" ? null : Number(raw);
		const ladder = target.closest(".difficulty-ladder");
		for (const chip of ladder?.querySelectorAll<HTMLButtonElement>(
			"button[data-difficulty]",
		) ?? []) {
			const selected = chip === target;
			chip.classList.toggle("checked", selected);
			chip.setAttribute("aria-pressed", String(selected));
		}
		this.#updatePreview();
	}

	static async #onRoll(this: TestDialogBase): Promise<void> {
		// Bead hyv: read attack-context selectors, if shown.
		if (this.#attackContext) {
			const root = this.element;
			const fireMode = root?.querySelector<HTMLSelectElement>("[data-fire-mode]")
				?.value as TestDialogAttackSelection["fireMode"];
			const aim = root?.querySelector<HTMLSelectElement>("[data-aim]")?.value;
			const charge = root?.querySelector<HTMLInputElement>("[data-charge]")?.checked;
			this.#attack = {
				...(this.#attackContext.ranged && fireMode !== "single"
					? { fireMode }
					: {}),
				...(aim === "half" ? { aimed: true } : {}),
				...(aim === "full" ? { aimed: true, aimFull: true } : {}),
				...(charge ? { flags: { charging: true } } : {}),
			};
		}
		this.#finish({
			modifiers: this.#collectModifiers(),
			...(this.#attackContext ? { attack: this.#attack } : {}),
			...(Object.keys(this.#conditionFlags()).length > 0
				? { flags: this.#conditionFlags() }
				: {}),
		});
	}

	static async #onCancel(this: TestDialogBase): Promise<void> {
		this.#finish(null);
	}

	override async close(
		options: Parameters<InstanceType<typeof ApplicationV2>["close"]>[0] = {},
	): Promise<this> {
		// Delegate exactly once: a pending promise resolves to null (cancel)
		// and #finish performs the close itself (bead uc5).
		if (this.#resolve) {
			this.#finish(null);
			return this;
		}
		return super.close(options);
	}
}

type modifiersRow = { label: string; value: number };