import { sumModifiers } from "../../rules-engine/src/index";
import type { Modifier } from "../../rules-engine/src/modifier";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export interface TestDialogRequest {
	/** Window title. */
	title: string;
	/** Unmodified target (characteristic / skill value). */
	baseTarget: number;
	/** Pre-collected contributor modifiers (shown as fixed rows). */
	contributors?: Modifier[];
}

export interface TestDialogResult {
	/** Contributor + custom modifiers to feed the funnel. */
	modifiers: Modifier[];
}

/**
 * Shared roll dialog for every test type (characteristic, skill, attack,
 * vehicle-handling): shows collected contributor modifiers as fixed rows, an
 * editable custom-modifier list with add/remove, a live clamped target
 * preview, and roll/cancel controls.
 */
export class TestDialog extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rt-test-dialog",
		classes: ["rogue-trader", "dialog", "test-dialog-app"],
		tag: "div",
		window: {
			minWidth: 420,
			minHeight: 220,
			resizable: true,
		},
		position: { width: 440, height: "auto" },
		actions: {
			addModifier: TestDialog.#onAdd,
			removeModifier: TestDialog.#onRemove,
			updateModifier: TestDialog.#onUpdate,
			roll: TestDialog.#onRoll,
			cancel: TestDialog.#onCancel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/rogue-trader/template/dialog/test-dialog.hbs",
		},
	};

	#baseTarget: number;
	#contributors: Array<{
		label: string;
		value: number;
		sourceLabel: string;
	}>;
	#custom: modifiersRow[];
	#resolve: ((result: TestDialogResult | null) => void) | null = null;

	constructor(options: { request: TestDialogRequest }) {
		const request = options.request;
		// Merge the request title into the window options so the dialog window
		// shows the test name instead of the default (bead uc5).
		super({ ...options, window: { title: request.title } });
		this.#baseTarget = request.baseTarget;
		this.#contributors = (request.contributors ?? []).map((m) => ({
			label: m.label,
			value: m.value,
			sourceLabel: m.source.label,
		}));
		// Start contributors in the custom list as well so the user can adjust
		// them before rolling? No: fixed rows are display-only; custom start empty.
		this.#custom = [];
	}

	/** Show the dialog; resolves null on cancel/close. */
	static async show(
		request: TestDialogRequest,
	): Promise<TestDialogResult | null> {
		const dialog = new TestDialog({ request });
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
		super.close({ force: true });
	}

	/** Current sum: fixed contributors + custom rows (re-read from inputs). */
	#totalModifier(): number {
		return sumModifiers(this.#collectModifiers());
	}

	/** Build the Modifier[] payload from fixed + custom rows. */
	#collectModifiers(): Modifier[] {
		const rows = this.element?.querySelectorAll<HTMLElement>(
			".modifier-row.custom",
		);
		const out: Modifier[] = this.#contributors.map((c, i) => ({
			id: `contributor:${i}`,
			source: { type: "effect" as const, label: c.sourceLabel },
			label: c.label,
			value: c.value,
		}));
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
		const el = this.element?.querySelector<HTMLElement>("[data-preview]");
		if (!el) return;
		const target = Math.min(
			100,
			Math.max(1, this.#baseTarget + this.#totalModifier()),
		);
		el.textContent = String(target);
	}

	async _prepareContext(options: object = {}) {
		const context = (await super._prepareContext(options)) as Record<
			string,
			unknown
		>;
		context.baseTarget = this.#baseTarget;
		context.contributors = this.#contributors;
		context.customModifiers = this.#custom;
		context.previewTarget = Math.min(
			100,
			Math.max(1, this.#baseTarget + this.#totalModifier()),
		);
		return context;
	}

	_onRender() {
		super._onRender();
		this.#updatePreview();
	}

	static async #onAdd(this: TestDialog): Promise<void> {
		this.#custom.push({ label: "", value: 10 });
		await this.render({ force: true });
	}

	static async #onRemove(
		this: TestDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index);
		if (Number.isInteger(index)) this.#custom.splice(index, 1);
		await this.render({ force: true });
	}

	/** Live-label update without rerender; values picked up at roll time. */
	static #onUpdate(this: TestDialog): void {
		this.#updatePreview();
	}

	static async #onRoll(this: TestDialog): Promise<void> {
		this.#finish({ modifiers: this.#collectModifiers() });
	}

	static async #onCancel(this: TestDialog): Promise<void> {
		this.#finish(null);
	}

	override async close(options: { force?: boolean } = {}): Promise<void> {
		// Delegate exactly once: a pending promise resolves to null (cancel)
		// and #finish performs the forced close itself (bead uc5).
		if (this.#resolve) {
			this.#finish(null);
			return;
		}
		await super.close(options);
	}
}

type modifiersRow = { label: string; value: number };
