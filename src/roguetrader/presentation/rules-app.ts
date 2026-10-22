/**
 * The rules app (epic wxut, child B4): the ONLY editor for named house-rule
 * profiles.
 *
 * WHY AN APP AT ALL: the two settings that hold the profiles
 * (`ruleProfiles`, `activeProfileId`) are registered `config: false`, so the
 * native Configure Settings form cannot show them — a GM edits profiles here
 * or not at all. The settings menu button (registerMenu in
 * bootstrap/config.ts, GM-restricted) opens this window.
 *
 * WHAT IT OWNS AND WHAT IT DOES NOT: every decision about profiles, knobs, the
 * diff, the JSON tab and the import/export pack lives in the pure view model
 * (presentation/rules-view-model.ts) plus the pure pack parser
 * (rules/rule-profile-pack.ts), which are unit-tested directly. This file
 * is the Foundry-coupled shell: window options, action handlers, the settings
 * reads/writes and the imperative input wiring (AGENT-GUIDE §3 — only
 * change/input events reach data-action on forms).
 *
 * IMPORT IS THE LOUD PATH: the pack text is validated by
 * parseRuleProfilePack, which names the wrong kind, the unsupported schema
 * version and every offending knob, and every one of those sentences reaches
 * the GM through the i18n keys mapped beside the problem table below. Nothing
 * here falls back to core rules silently: a refusal is a notice.
 *
 * HAZARDS ARE VISIBLE: every knob carries its hazard class and the core value
 * beside the control, and the diff panel marks the ledger-assuming knobs
 * (advancement.preSpentBaseline, advancement.eliteAdvanceBaseCost) BREAKING,
 * because changing them makes the spent-xp ledger of every existing character
 * wrong. A silent modifier is a bug; a silent house rule is the same bug.
 *
 * WHOSE KNOBS (bead w9sa.2): the form, the diff, the JSON tab and the pack tab
 * all resolve the ACTIVE system's registry (`ruleKnobs()` /
 * `ruleKnobRegistry()` in src/ffg/domain/rule-knobs.ts) — RT's until a sibling
 * system registers its own. This file therefore imports no RT registry and
 * names no RT knob key: even the whole-replacement table control binds to
 * whatever knob the registry marks `control: "table"` (`tableKnobKey`), so a
 * sibling system's table knob works and an RT key stays in exactly one place.
 */

import { TEMPLATE_ROOT } from "../../ffg/domain/template-root";
import {
	knobByKey,
	ruleKnobRegistry,
	ruleKnobs,
	validateProfile,
} from "../../ffg/domain/rule-knobs";
import { getPorts } from "../infrastructure/foundry/ports";
import {
	ACTIVE_PROFILE_ID_SETTING,
	RULE_PROFILES_SETTING,
} from "../rules/homebrew";
import {
	packProblemParams,
	parseRuleProfilePack,
	type RuleProfilePackBase,
	type RuleProfilePackProblemKind,
	type RuleProfilePackProblem,
} from "../rules/rule-profile-pack";
import {
	activeEntry,
	applyProfileAction,
	breakingDiffRowCount,
	CORE_PROFILE_ID,
	coerceKnobInput,
	deltaFromDraft,
	jsonTabResult,
	jsonTabText,
	knobFieldView,
	knobGroupViews,
	moduleProfileEntries,
	moduleProfilesOf,
	nextProfileId,
	packExportRows,
	packExportText,
	packImportPlan,
	packImportState,
	packSlug,
	persistRuleProfiles,
	profileDiffRows,
	profileList,
	ruleProfileWrite,
	selectedProfile,
	selectedRow,
	skippedProfilesFrom,
	stateFromSettings,
	tableBandConflicts,
	tableBandRows,
	tableFromBandRows,
	tableKnobKey,
	type ModuleProfileRow,
	type ProfileSource,
	type RuleProfileState,
	type RulePackScope,
	type SkippedProfileReason,
	type TableBandRow,
} from "./rules-view-model";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/** The app's four panels, in tab order. */
const TABS = ["knobs", "json", "diff", "pack"] as const;
export type RulesTab = (typeof TABS)[number];

function tabLabelKey(tab: RulesTab): string {
	return `RULES.TAB_${tab.toUpperCase()}`;
}

function isRulesTab(value: string | undefined): value is RulesTab {
	return TABS.includes(value as RulesTab);
}

/**
 * The sentence for each way a stored profile row can be unreadable. Every one
 * of them is localised: a GM with a hand-edited setting sees a translated
 * explanation, not English from the pure layer.
 */
const SKIPPED_LABEL_KEYS: Readonly<Record<SkippedProfileReason, string>> = {
	"not-a-list": "RULES.PROFILES_NOT_A_LIST",
	"not-a-row": "RULES.PROFILE_SKIPPED_NOT_ROW",
	"no-id": "RULES.PROFILE_SKIPPED_NO_ID",
	"no-delta": "RULES.PROFILE_SKIPPED_NO_DELTA",
};

/**
 * The sentence for each way a rules pack can be refused. Every one is
 * LOCALISED and every one names what was wrong — the pack's kind, its schema
 * version, or the profile's position inside it — because a GM who pasted a
 * pack from another system must be told that in the app, not in a console.
 *
 * `profile-delta-invalid` is deliberately absent: its detail rows are the
 * validator's own sentences (they name the offending knob), so it renders as
 * a localised header plus those rows rather than one wrapped sentence.
 */
const PACK_PROBLEM_LABEL_KEYS: Readonly<
	Record<Exclude<RuleProfilePackProblemKind, "profile-delta-invalid">, string>
> = {
	"not-json": "RULES.PACK_ERROR_NOT_JSON",
	"not-an-object": "RULES.PACK_ERROR_NOT_AN_OBJECT",
	"wrong-kind": "RULES.PACK_ERROR_WRONG_KIND",
	"unsupported-schema": "RULES.PACK_ERROR_SCHEMA_VERSION",
	"profiles-not-a-list": "RULES.PACK_ERROR_PROFILES_NOT_LIST",
	"profile-not-a-row": "RULES.PACK_ERROR_PROFILE_NOT_ROW",
	"profile-no-id": "RULES.PACK_ERROR_PROFILE_NO_ID",
	"profile-bad-base": "RULES.PACK_ERROR_PROFILE_BASE",
	"profile-no-delta": "RULES.PACK_ERROR_PROFILE_NO_DELTA",
	"profile-duplicate-id": "RULES.PACK_ERROR_DUPLICATE_ID",
};

/**
 * Every refusal as notice lines: the localised sentence, with the pack's own
 * words (the wrong kind, the unsupported version, the profile's id)
 * interpolated. The `profile-delta-invalid` header is followed by the
 * validator's rows, each of which names the knob it refused.
 */
function packProblemLines(
	problems: readonly RuleProfilePackProblem[],
): readonly string[] {
	const i18n = getPorts().i18n;
	const lines: string[] = [];
	for (const problem of problems) {
		if (problem.kind === "profile-delta-invalid") {
			lines.push(
				i18n.t("RULES.PACK_ERROR_DELTA_INVALID", {
					index: String(problem.index),
					id: problem.id,
				}),
			);
			lines.push(...problem.problems);
			continue;
		}
		lines.push(
			i18n.t(PACK_PROBLEM_LABEL_KEYS[problem.kind], packProblemParams(problem)),
		);
	}
	return lines;
}

/** A thrown value as one clause of a notice line. */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The base an imported pack was authored against, when every profile that
 * carries one agrees. A pack normally comes from one world, so they do; a
 * hand-assembled one might not, and then the notice says nothing rather than
 * naming one profile's basis for all of them.
 */
function agreedPackBase(
	profiles: readonly { readonly base: RuleProfilePackBase | null }[],
): RuleProfilePackBase | null {
	const bases = profiles.filter(
		(profile): profile is { base: RuleProfilePackBase } => profile.base !== null,
	);
	if (bases.length === 0) return null;
	const first = bases[0]!.base;
	const agreed = bases.every(
		(profile) =>
			profile.base.profile === first.profile &&
			profile.base.systemVersion === first.systemVersion,
	);
	return agreed ? first : null;
}

/**
 * The slice of the settings surface the app needs. Narrowed here so a missing
 * or stripped-down `game.settings` degrades to core rules instead of throwing
 * (the pre-init window, or a future headless harness).
 */
interface RuleProfileSettingsSurface {
	get(ns: string, key: string): unknown;
	set(ns: string, key: string, value: unknown): unknown;
	registerMenu(ns: string, key: string, data: object): void;
}

/**
 * The clipboard slice the export needs (Foundry's `game.clipboard`). Narrowed
 * like the settings surface above so a stripped harness degrades to a refusal
 * in the notice strip instead of a throw out of a button handler.
 */
interface ClipboardSurface {
	copyPlainText(text: string): Promise<void> | void;
}

/** The utils slice the download needs (Foundry's `foundry.utils`). */
interface UtilsSurface {
	saveDataToFile(data: string, type: string, filename: string): void;
}

/** The system slice the pack's `base` is filled from. */
interface SystemSurface {
	id?: unknown;
	version?: unknown;
}

function clipboardSurface(): ClipboardSurface | undefined {
	return (game as { clipboard?: ClipboardSurface }).clipboard;
}

function utilsSurface(): UtilsSurface | undefined {
	return (foundry as { utils?: UtilsSurface }).utils;
}

function systemSurface(): SystemSurface | undefined {
	return (game as { system?: SystemSurface }).system;
}

/**
 * The profile id and version a pack records as its `base`: what the delta was
 * authored against. The id comes from the RUNNING profile (the seam a sibling
 * module can swap) and the version from the system manifest; an unknown
 * version is left off rather than guessed at.
 */
function packBase(): RuleProfilePackBase {
	const version = systemSurface()?.version;
	return {
		profile: getPorts().config.profile().id,
		...(typeof version === "string" && version.trim() !== ""
			? { systemVersion: version.trim() }
			: {}),
	};
}

/** One line in the app's notice strip. */
interface RulesNotice {
	readonly kind: "ok" | "error";
	readonly errors: readonly string[];
	/** A localised heading that replaces the generic Saved/Not saved word. */
	readonly heading?: string;
	/** A localised summary sentence beside the heading. */
	readonly message?: string;
}

/**
 * The settings namespace: the system id, with the pre-init fallback. Same
 * shape as bootstrap/config.ts#systemId, repeated because presentation may not
 * import bootstrap (the architecture boundary test).
 */
const SYSTEM_ID_FALLBACK = "rogue-trader";

function settingsNs(): string {
	return game.system?.id ?? SYSTEM_ID_FALLBACK;
}

function settingsSurface(): RuleProfileSettingsSurface | undefined {
	return game.settings as unknown as RuleProfileSettingsSurface | undefined;
}

/** Read a rule-profile setting; an absent surface or a refused read is "". */
function readSetting(key: string): unknown {
	const settings = settingsSurface();
	if (!settings) return "";
	try {
		return settings.get(settingsNs(), key);
	} catch (error) {
		console.warn(`rogue-trader | could not read ${key}:`, error);
		return "";
	}
}

/**
 * The profiles MODULES registered at their own init (bead wxut.6, sharing tier
 * T2).
 *
 * Read through the same extension namespace a module registers through
 * (`CONFIG.ROGUE_TRADER.ruleProfiles`, attached beside `registerRuleProfile` by
 * bootstrap/config.ts), so the app sees exactly the registry the rules run on.
 * A missing namespace, a missing provider or a hostile one is NO MODULE
 * PROFILES — a module's registration must never be able to break the app, and
 * the world's own profiles are unaffected by its absence.
 */
function readModuleProfiles(): readonly ModuleProfileRow[] {
	const rtc = (CONFIG as unknown as {
		ROGUE_TRADER?: { ruleProfiles?: unknown };
	}).ROGUE_TRADER;
	const registered = rtc?.ruleProfiles;
	if (typeof registered !== "function") return [];
	try {
		const rows = (
			registered as () => readonly ModuleProfileRow[]
		)();
		if (!Array.isArray(rows)) return [];
		return rows
			.filter(
				(row): row is ModuleProfileRow =>
					typeof row === "object" &&
					row !== null &&
					typeof (row as { id?: unknown }).id === "string" &&
					typeof (row as { name?: unknown }).name === "string" &&
					typeof (row as { delta?: unknown }).delta === "object" &&
					(row as { delta: unknown }).delta !== null,
			)
			.map((row) => ({
				id: row.id.trim(),
				name: row.name.trim(),
				delta: row.delta,
			}));
	} catch (error) {
		console.warn("rogue-trader | could not read module profiles:", error);
		return [];
	}
}

export class RulesApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-rules-app",
		classes: ["rogue-trader", "dialog", "rules-app", "rt-component"],
		position: { width: 860, height: 660 },
		// Resizable per the repo UI rule, with the min sizes the CSS clamps
		// mirror: ApplicationV2 clamps the resize to the element's computed
		// minWidth/minHeight (core application.mjs), so the numbers live twice.
		window: {
			title: "RULES.APP_TITLE",
			resizable: true,
			minWidth: 640,
			minHeight: 480,
		},
		actions: {
			tab: RulesApp.#onTab,
			selectProfile: RulesApp.#onSelectProfile,
			activateProfile: RulesApp.#onActivateProfile,
			createProfile: RulesApp.#onCreateProfile,
			duplicateProfile: RulesApp.#onDuplicateProfile,
			renameProfile: RulesApp.#onRenameProfile,
			deleteProfile: RulesApp.#onDeleteProfile,
			addBand: RulesApp.#onAddBand,
			removeBand: RulesApp.#onRemoveBand,
			save: RulesApp.#onSave,
			saveJson: RulesApp.#onSaveJson,
			exportPack: RulesApp.#onExportPack,
			downloadPack: RulesApp.#onDownloadPack,
			importPack: RulesApp.#onImportPack,
		},
	};

	// No `scrollable` descriptor: the app's scroll containers all live in
	// css/rules-app.css (its Scrolling section) and none of them is the part
	// root — the window content scrolls, and the panel and the sidebar scroll
	// inside the columns. The root this part renders is a plain flex column, so a
	// `scrollable` selector here would name an element that never scrolls.
	static PARTS = {
		form: {
			template: `${TEMPLATE_ROOT}dialog/rules-app.hbs`,
		},
	};

	/** Everything stored in the two settings, as app state. */
	#state: RuleProfileState = { rows: [], activeId: "" };
	/** The row being edited; CORE_PROFILE_ID means the Core pseudo-entry. */
	#selectedId = CORE_PROFILE_ID;
	/** The open panel. */
	#tab: RulesTab = "knobs";
	/** Pending knob edits: knob key -> value (absent key = core rule). */
	#draft: Record<string, unknown> = {};
	/** Pending name edit for the selected row. */
	#draftName = "";
	/** Pending hit-location band rows (the whole-replacement table control). */
	#tableRows: readonly TableBandRow[] = [];
	/** The JSON tab's text, per profile. */
	#jsonText = "";
	/** The pack tab's export scope: the active profile, or all of them. */
	#packScope: RulePackScope = "active";
	/** The pack tab's import textarea (a pasted or picked pack). */
	#packText = "";
	/** Whether a single-profile import also makes it the profile in force. */
	#packActivate = false;
	/** The last save/refusal, until the GM touches something again. */
	#notice: RulesNotice | null = null;

	// -----------------------------------------------------------------------
	// Reading state and building the view
	// -----------------------------------------------------------------------

	async _prepareContext(_options: object = {}) {
		const context = (await super._prepareContext(_options as never)) as Record<
			string,
			unknown
		>;
		const storedProfiles = readSetting(RULE_PROFILES_SETTING);
		const moduleProfiles = readModuleProfiles();
		const state = stateFromSettings(
			storedProfiles,
			readSetting(ACTIVE_PROFILE_ID_SETTING),
			moduleProfiles,
		);
		this.#state = state;
		// The registry in force (bead w9sa.2): RT's own knobs by default, a
		// sibling system's once IT registers. Read per render, never cached in a
		// field, so a registry swapped by another module's boot is picked up.
		const registry = ruleKnobs();
		const packRegistry = ruleKnobRegistry();
		// A selected id that vanished (deleted elsewhere, or a settings edit)
		// falls back to the Core pseudo-entry rather than showing a stale panel.
		// A MODULE profile counts as known (bead wxut.6): it is listed, so it can
		// be selected and inspected, read-only.
		if (!selectedProfile(state, this.#selectedId).known)
			this.#selectProfile(CORE_PROFILE_ID);

		const selected = selectedProfile(state, this.#selectedId);
		const editable = selected.editable;
		const active = activeEntry(state);
		const diffRows = profileDiffRows(this.#pendingDelta(), registry);
		context.tabs = TABS.map((tab) => ({ id: tab, labelKey: tabLabelKey(tab) }));
		context.tab = this.#tab;
		context.profiles = profileList(state);
		// The module group (bead wxut.6): its own list, read-only, activation only.
		context.moduleProfiles = moduleProfileEntries(state);
		context.readOnlyKey =
			selected.source === "module"
				? "RULES.MODULE_READONLY"
				: "RULES.CORE_READONLY";
		// Rows the decode could not read are SHOWN, never console-only.
		context.skippedProfiles = skippedProfilesFrom(storedProfiles).map(
			(entry) =>
				getPorts().i18n.t(SKIPPED_LABEL_KEYS[entry.reason], {
					index: String(entry.index),
				}),
		);
		context.selectedId = this.#selectedId;
		context.editable = editable;
		context.nameValue = this.#draftName;
		context.selectedIsActive = active?.id === this.#selectedId;
		context.groups = knobGroupViews(this.#mergedDraft(), editable, registry);
		context.tableConflicts = tableBandConflicts(this.#tableRows);
		context.jsonText = this.#jsonText;
		context.diffRows = diffRows;
		context.diffBreakingCount = breakingDiffRowCount(diffRows);
		// The pack tab: what the chosen scope exports (the rows, so the panel can
		// say "nothing to export" while core rules are in force), the JSON the Copy
		// and Download buttons carry, and the import side's own state.
		const packRows = packExportRows(state, this.#packScope);
		context.packScope = this.#packScope;
		context.packExportCount = packRows.length;
		context.packTextOut =
			packRows.length > 0
				? packExportText(packRows, this.#packBase(), packRegistry)
				: "";
		context.packTextIn = this.#packText;
		context.packActivate = this.#packActivate;
		context.notice = this.#notice;
		return context;
	}

	// -----------------------------------------------------------------------
	// App state transitions
	// -----------------------------------------------------------------------

	/** The panels seed from whichever row is selected: the world's, or a module's. */
	#selectProfile(id: string): void {
		this.#selectedId = id;
		const row = selectedProfile(this.#state, id);
		this.#draft = { ...row.delta };
		this.#draftName = row.name;
		this.#tableRows = tableBandRows(this.#storedTableValue(row.delta));
		this.#jsonText = jsonTabText(row.delta);
		this.#notice = null;
	}

	/**
	 * The active registry's whole-replacement TABLE knob — RT's own
	 * `tables.hitLocations` — or null when the registry has no table knob at all.
	 * Read from the registry on every use rather than cached: a sibling system
	 * registers its registry at its own boot, which is not a render.
	 */
	#tableKnobKey(): string | null {
		return tableKnobKey(ruleKnobs());
	}

	/** A stored delta's value for that knob (undefined when there is none). */
	#storedTableValue(delta: Readonly<Record<string, unknown>>): unknown {
		const key = this.#tableKnobKey();
		return key === null ? undefined : delta[key];
	}

	/**
	 * The draft the panels see: the knob values, with the table control's rows
	 * as the table value. The table is always present so the diff and the form
	 * agree; deltaFromDraft drops it again when it matches the core table.
	 */
	#mergedDraft(): Record<string, unknown> {
		const merged: Record<string, unknown> = { ...this.#draft };
		const key = this.#tableKnobKey();
		if (key !== null) merged[key] = tableFromBandRows(this.#tableRows);
		return merged;
	}

	/** The delta the knobs tab would store right now. */
	#pendingDelta() {
		return deltaFromDraft(this.#mergedDraft());
	}

	/**
	 * The base the pack records: which rules this world's deltas were authored
	 * against. Recomputed per render so a GM exporting right after an upgrade
	 * stamps the version the export actually happened at.
	 */
	#packBase(): RuleProfilePackBase {
		return packBase();
	}

	/** The JSON the Copy/Download buttons carry for the current export scope. */
	#packExportJson(): string {
		const rows = packExportRows(this.#state, this.#packScope);
		if (rows.length === 0) return "";
		return packExportText(rows, this.#packBase(), ruleKnobRegistry());
	}

	/** Replace the stored state, optionally selecting a row, then write back. */
	#commit(
		next: RuleProfileState,
		selectId?: string,
		ok: boolean | string = false,
		notice?: Pick<RulesNotice, "heading" | "message">,
	): void {
		this.#state = next;
		if (selectId !== undefined) this.#selectProfile(selectId);
		const surface = settingsSurface();
		const write = ruleProfileWrite(this.#state);
		try {
			if (surface) {
				persistRuleProfiles(surface, settingsNs(), write, warnWrite);
			}
		} catch (error) {
			warnWrite(error);
		}
		if (ok) {
			this.#notice = {
				kind: "ok",
				errors: [],
				...notice,
			};
		}
		this.render({ force: true } as never);
	}

	/** A refused action: say so in the notice strip, never silently drop it. */
	#refuse(kind: RulesNotice["kind"], errors: readonly string[]): void {
		this.#notice = { kind, errors };
		this.render({ force: true } as never);
	}

	// -----------------------------------------------------------------------
	// Imperative input wiring (AGENT-GUIDE §3)
	// -----------------------------------------------------------------------

	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		const root = this.element;
		if (!root) return;
		// The profile name is app state until the GM renames or saves: a write
		// per keystroke would be a setting spam storm.
		wireProfileName(root, (value) => {
			this.#draftName = value;
			this.#notice = null;
		});
		// The JSON tab holds its own text until it is saved.
		wireJsonText(root, (value) => {
			this.#jsonText = value;
			this.#notice = null;
		});
		// The knob controls first; the band inputs also carry the knob key, so
		// they are excluded here and wired separately below (one listener per
		// element — the dataset.wired guard would otherwise eat them).
		for (const input of root.querySelectorAll<HTMLInputElement>(
			"[data-knob]:not([data-band])",
		)) {
			this.#wireKnob(input);
		}
		for (const input of root.querySelectorAll<HTMLInputElement>(
			"[data-band]",
		)) {
			this.#wireBand(input);
		}
		// The pack tab's controls: the scope select, the activate checkbox, the
		// import textarea and the file picker. All four are imperative because
		// Foundry's action system dispatches CLICKS, and AGENT-GUIDE §3 keeps
		// change/input events off the form's data-action path.
		wirePackScope(root, (scope) => {
			if (scope === this.#packScope) return;
			this.#packScope = scope;
			this.#notice = null;
			// The preview text is the scope, so the panel must be rebuilt.
			this.render({ force: true } as never);
		});
		wirePackActivate(root, (checked) => {
			this.#packActivate = checked;
		});
		wirePackText(root, (value) => {
			this.#packText = value;
			this.#notice = null;
		});
		wirePackFile(root, (file) => {
			this.#readPackFile(file);
		});
	}

	/**
	 * Read a picked .json file into the import textarea.
	 *
	 * Reading fills the text and says so; it does NOT import. A GM who picked
	 * the wrong file sees it in the textarea before anything is written, and
	 * the single import path (validate the text) is the only way a pack can
	 * reach the world.
	 */
	async #readPackFile(file: File): Promise<void> {
		try {
			const text = await file.text();
			this.#packText = text;
			const i18n = getPorts().i18n;
			this.#notice = {
				kind: "ok",
				errors: [],
				message: i18n.t("RULES.PACK_FILE_READ", { name: file.name }),
			};
			this.render({ force: true } as never);
		} catch (error) {
			this.#refuse(
				"error",
				[
					getPorts().i18n.t("RULES.PACK_FILE_READ_FAILED", {
						name: file.name,
						message: describeError(error),
					}),
				],
			);
		}
	}

	/** Wire one generated knob control: number/select input, or checkbox. */
	#wireKnob(input: HTMLInputElement): void {
		if (input.dataset.wired) return;
		input.dataset.wired = "1";
		const key = input.dataset.knob ?? "";
		const knob = knobByKey(key, ruleKnobs());
		if (!knob) return;
		const apply = (): void => {
			const raw = knob.control === "boolean" ? input.checked : input.value;
			this.#draft = {
				...this.#draft,
				[key]: coerceKnobInput(knob, raw),
			};
			this.#notice = null;
			this.#syncKnobFlag(key, input);
		};
		// input + change: keep the state current and refresh the "house rule"
		// chip in place. A re-render is deliberately NOT issued: the form is long,
		// and re-rendering on every commit would scroll the window back to the top.
		input.addEventListener("input", apply);
		input.addEventListener("change", apply);
	}

	/** Wire one hit-location band row's band/location text. */
	#wireBand(input: HTMLInputElement): void {
		if (input.dataset.wired) return;
		input.dataset.wired = "1";
		const index = Number(input.dataset.index ?? "-1");
		if (!Number.isInteger(index) || index < 0) return;
		const field = input.dataset.band === "location" ? "location" : "band";
		const apply = (): void => {
			const rows = [...this.#tableRows];
			const row = rows[index];
			if (!row) return;
			rows[index] = { ...row, [field]: input.value };
			this.#tableRows = rows;
			this.#notice = null;
		};
		input.addEventListener("input", apply);
		input.addEventListener("change", () => {
			apply();
			const tableKey = this.#tableKnobKey();
			if (tableKey !== null) this.#syncKnobFlag(tableKey, input);
		});
	}

	/**
	 * Refresh one knob row's "house rule" chip in place.
	 *
	 * The chip is derived state: does the pending value differ from the Core
	 * Rulebook value. It is recomputed from the view model and patched into the
	 * DOM rather than waited on from a re-render.
	 */
	#syncKnobFlag(knobKey: string, holder: HTMLElement | null): void {
		const knob = knobByKey(knobKey, ruleKnobs());
		const row = holder?.closest("[data-knob-key]");
		if (!knob || !row) return;
		const field = knobFieldView(knob, this.#mergedDraft(), true);
		row.classList.toggle("overridden", field.overridden);
		const flag = row.querySelector<HTMLElement>(".rule-knob-flag");
		if (flag) flag.hidden = !field.overridden;
	}

	// -----------------------------------------------------------------------
	// Actions
	// -----------------------------------------------------------------------

	/** Switch panel. */
	static async #onTab(
		this: RulesApp,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const tab = target.dataset.tabId;
		if (!isRulesTab(tab)) return;
		if (this.#tab !== tab) this.#notice = null;
		this.#tab = tab;
		this.render({ force: true } as never);
	}

	/** Show a profile (or the Core pseudo-entry) in the panels. */
	static async #onSelectProfile(
		this: RulesApp,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.profileId ?? CORE_PROFILE_ID;
		this.#selectProfile(id);
		this.render({ force: true } as never);
	}

	/** Make a profile (or Core) the one the rules run on. */
	static async #onActivateProfile(
		this: RulesApp,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.profileId ?? CORE_PROFILE_ID;
		const next = applyProfileAction(this.#state, { kind: "activate", id });
		if (next === this.#state) {
			this.#refuse("error", [`unknown profile "${id}" — nothing activated`]);
			return;
		}
		this.#commit(next, undefined);
	}

	/** Append an empty profile and select it. */
	static async #onCreateProfile(this: RulesApp): Promise<void> {
		// A module's id is off limits too (bead wxut.6): a world profile sharing a
		// module profile's id would be ambiguous about which one is in force.
		const id = nextProfileId(
			this.#state.rows,
			moduleProfilesOf(this.#state),
		);
		const name = profileName(this.#state.rows.length + 1);
		const next = applyProfileAction(this.#state, { kind: "create", id, name });
		this.#commit(next, id);
	}

	/** Append a copy of the selected profile's delta under a new id. */
	static async #onDuplicateProfile(this: RulesApp): Promise<void> {
		const selected = selectedProfile(this.#state, this.#selectedId);
		const source =
			selected.source === "world"
				? selectedRow(this.#state, this.#selectedId)
				: null;
		if (!source) {
			this.#refuse("error", readOnlyEditRefusal(selected.source));
			return;
		}
		const newId = nextProfileId(
			this.#state.rows,
			moduleProfilesOf(this.#state),
		);
		const name = copyName(source.name);
		const next = applyProfileAction(this.#state, {
			kind: "duplicate",
			id: source.id,
			newId,
			name,
		});
		this.#commit(next, newId);
	}

	/** Apply the pending name to the selected profile. */
	static async #onRenameProfile(this: RulesApp): Promise<void> {
		const selected = selectedProfile(this.#state, this.#selectedId);
		const row =
			selected.source === "world"
				? selectedRow(this.#state, this.#selectedId)
				: null;
		if (!row) {
			this.#refuse("error", readOnlyEditRefusal(selected.source));
			return;
		}
		const name = this.#draftName.trim();
		if (name === "") {
			this.#refuse("error", [
				"a profile needs a name — the rename was refused",
			]);
			return;
		}
		const next = applyProfileAction(this.#state, {
			kind: "rename",
			id: row.id,
			name,
		});
		if (next === this.#state) {
			this.#refuse("error", [`could not rename "${row.id}"`]);
			return;
		}
		this.#commit(next, undefined, true);
	}

	/** Delete the selected profile (Core is refused). */
	static async #onDeleteProfile(
		this: RulesApp,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.profileId ?? CORE_PROFILE_ID;
		if (id === CORE_PROFILE_ID) {
			this.#refuse("error", [
				"the Core Rulebook cannot be deleted — it is the rules, not a profile",
			]);
			return;
		}
		// A module's profile is nobody's to delete (bead wxut.6): the list marks it
		// read-only and the button is disabled, so this only guards a stray
		// dispatch — refused by name, never a silent no-op.
		if (selectedProfile(this.#state, id).source === "module") {
			this.#refuse("error", readOnlyEditRefusal("module"));
			return;
		}
		const row = selectedRow(this.#state, id);
		if (!row) return;
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: getPorts().i18n.t("RULES.PROFILE_DELETE_TITLE") },
			content: getPorts().i18n.t("RULES.PROFILE_DELETE_CONFIRM", {
				name: row.name,
			}),
		});
		if (confirmed !== true) return;
		const next = applyProfileAction(this.#state, { kind: "delete", id });
		// Deleting the row being edited selects Core; deleting another row keeps
		// the current selection.
		this.#commit(next, this.#selectedId === id ? CORE_PROFILE_ID : undefined);
	}

	/** Add an empty band row to the hit-location table control. */
	static async #onAddBand(this: RulesApp): Promise<void> {
		this.#tableRows = [...this.#tableRows, { band: "", location: "" }];
		this.#notice = null;
		this.render({ force: true } as never);
	}

	/** Remove one band row from the hit-location table control. */
	static async #onRemoveBand(
		this: RulesApp,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index ?? "-1");
		this.#tableRows = this.#tableRows.filter((_, i) => i !== index);
		this.#notice = null;
		this.render({ force: true } as never);
	}

	/** Save the knob form: validate, then write the profile's delta. */
	static async #onSave(this: RulesApp): Promise<void> {
		const refusal = this.#validatePending();
		if (refusal) {
			this.#refuse("error", refusal);
			return;
		}
		this.#writePendingDelta(this.#pendingDelta());
	}

	/** Save the JSON tab: validate the text, then write the profile's delta. */
	static async #onSaveJson(this: RulesApp): Promise<void> {
		const result = jsonTabResult(this.#jsonText, ruleKnobs());
		if (!result.ok) {
			this.#refuse("error", result.errors);
			return;
		}
		this.#writePendingDelta(result.delta);
	}

	/**
	 * Copy the pack to the clipboard (sharing tier T0).
	 *
	 * Foundry's clipboard helper is the right surface: it handles the
	 * permissions a browser document is not allowed to assume, and it is
	 * absent only in a stripped harness — which gets a notice, not a throw.
	 */
	static async #onExportPack(this: RulesApp): Promise<void> {
		const text = this.#packExportJson();
		if (text === "") {
			this.#refuse("error", [getPorts().i18n.t("RULES.PACK_EXPORT_EMPTY")]);
			return;
		}
		const clipboard = clipboardSurface();
		if (!clipboard) {
			this.#refuse("error", [
				getPorts().i18n.t("RULES.PACK_COPY_FAILED", {
					message: "no clipboard surface",
				}),
			]);
			return;
		}
		try {
			await clipboard.copyPlainText(text);
			this.#notice = {
				kind: "ok",
				errors: [],
				heading: getPorts().i18n.t("RULES.PACK_COPIED"),
			};
			this.render({ force: true } as never);
		} catch (error) {
			this.#refuse("error", [
				getPorts().i18n.t("RULES.PACK_COPY_FAILED", {
					message: describeError(error),
				}),
			]);
		}
	}

	/**
	 * Download the pack as a .json file (sharing tier T1). The name is localised
	 * chrome plus the GM's own profile name, so the file says which house rules
	 * it carries (a whole-world export has its own stem).
	 */
	static async #onDownloadPack(this: RulesApp): Promise<void> {
		const text = this.#packExportJson();
		if (text === "") {
			this.#refuse("error", [getPorts().i18n.t("RULES.PACK_EXPORT_EMPTY")]);
			return;
		}
		const utils = utilsSurface();
		if (!utils) {
			this.#refuse("error", [getPorts().i18n.t("RULES.PACK_DOWNLOAD_FAILED")]);
			return;
		}
		const i18n = getPorts().i18n;
		const name =
			this.#packScope === "all"
				? ""
				: (selectedProfile(this.#state, this.#state.activeId).name ?? "");
		// The file name is localised chrome plus the GM's own profile name: a
		// whole-world export has no single profile to name, so it gets its own
		// stem rather than an English "all" glued on.
		const stem =
			this.#packScope === "all"
				? i18n.t("RULES.PACK_EXPORT_FILENAME_ALL")
				: `${i18n.t("RULES.PACK_EXPORT_FILENAME")}-${packSlug(name)}`;
		try {
			utils.saveDataToFile(text, "application/json", `${stem}.json`);
			this.#notice = {
				kind: "ok",
				errors: [],
				heading: i18n.t("RULES.PACK_DOWNLOADED", { file: `${stem}.json` }),
			};
			this.render({ force: true } as never);
		} catch (error) {
			this.#refuse("error", [
				i18n.t("RULES.PACK_DOWNLOAD_FAILED", {
					message: describeError(error),
				}),
			]);
		}
	}

	/**
	 * Import the pack in the textarea.
	 *
	 * THE LOUD PATH: the whole pack is validated by parseRuleProfilePack and a
	 * refusal names the offending kind, schema version or knob — this is NOT
	 * parseStoredDelta's warn-and-fallback, which exists so a world's own
	 * stored value can never stop the rules from running. A same-id profile is
	 * only replaced after the GM confirms, and a fresh profile joins the list
	 * (becoming active when the GM asked for it).
	 */
	static async #onImportPack(this: RulesApp): Promise<void> {
		const i18n = getPorts().i18n;
		const parsed = parseRuleProfilePack(this.#packText, ruleKnobRegistry());
		if (!parsed.valid) {
			this.#refuse("error", packProblemLines(parsed.problems));
			return;
		}
		if (parsed.profiles.length === 0) {
			this.#refuse("error", [i18n.t("RULES.PACK_IMPORTED_NONE")]);
			return;
		}
		const plan = packImportPlan(this.#state, parsed.profiles, this.#packActivate);
		if (plan.clashes.length > 0) {
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: i18n.t("RULES.PACK_OVERWRITE_TITLE") },
				content: i18n.t("RULES.PACK_OVERWRITE_CONFIRM", {
					names: plan.clashes
						.map((clash) => `${clash.existingName} (${clash.id})`)
						.join(", "),
				}),
			});
			if (confirmed !== true) return;
		}
		const names = parsed.profiles
			.map((profile) => profile.name)
			.join(", ");
		// A multi-profile import cannot honour "activate it": which profile was
		// a guess, so the notice SAYS the active profile was left alone rather
		// than quietly ignoring the checkbox.
		const skipped =
			this.#packActivate && !plan.canActivate
				? i18n.t("RULES.PACK_IMPORT_ACTIVATE_SKIPPED")
				: "";
		// What the pack was authored against: the whole point of carrying a
		// base, and the thing a GM can compare with the version they run.
		const base = agreedPackBase(parsed.profiles);
		const baseLine = base
			? base.systemVersion === undefined
				? i18n.t("RULES.PACK_IMPORTED_BASE", { profile: base.profile })
				: i18n.t("RULES.PACK_IMPORTED_BASE_VERSION", {
						profile: base.profile,
						version: base.systemVersion,
					})
			: "";
		this.#packText = "";
		this.#commit(
			packImportState(this.#state, plan),
			parsed.profiles[0]!.id,
			true,
			{
				heading: i18n.t("RULES.PACK_IMPORTED_TITLE"),
				message: [
					i18n.t("RULES.PACK_IMPORTED", {
						added: String(plan.added.length),
						replaced: String(plan.clashes.length),
						names,
					}),
					baseLine,
					skipped,
				]
					.filter((line) => line !== "")
					.join(" "),
			},
		);
	}

	/** Shared tail of both save paths: persist the delta (and any rename). */
	#writePendingDelta(delta: Record<string, unknown>): void {
		const selected = selectedProfile(this.#state, this.#selectedId);
		const row =
			selected.source === "world"
				? selectedRow(this.#state, this.#selectedId)
				: null;
		if (!row) {
			this.#refuse("error", readOnlyEditRefusal(selected.source));
			return;
		}
		let next = applyProfileAction(this.#state, {
			kind: "saveDelta",
			id: row.id,
			delta,
		});
		if (next === this.#state) {
			this.#refuse("error", [`could not save profile "${row.id}"`]);
			return;
		}
		const name = this.#draftName.trim();
		if (name !== "" && name !== row.name) {
			next = applyProfileAction(next, { kind: "rename", id: row.id, name });
		}
		// Reseed the panels from what was stored: the JSON tab writes the delta
		// directly, so the knobs tab and the table must not keep a stale draft.
		this.#draft = { ...delta };
		this.#tableRows = tableBandRows(this.#storedTableValue(delta));
		this.#commit(next, undefined, true);
	}

	/**
	 * Why the pending knob form cannot be saved, or null when it can. Both
	 * checks name the offending band text, so a half-typed table rule is
	 * reported rather than quietly applied or quietly dropped.
	 */
	#validatePending(): readonly string[] | null {
		const tableKey = this.#tableKnobKey();
		const conflicts = tableBandConflicts(this.#tableRows);
		if (conflicts.length > 0) {
			return [
				...conflicts.map(
					(band) =>
						`"${tableKey ?? "the band table"}" lists the band "${band}" twice — each band is one location`,
				),
			];
		}
		const validation = validateProfile(ruleKnobs(), this.#pendingDelta());
		if (!validation.valid) return validation.errors;
		return null;
	}
}

/** A rejected write must escape nothing: a read-only world is not a crash. */
function warnWrite(error: unknown): void {
	console.warn("rogue-trader | could not write the rule profiles:", error);
}

/**
 * Why an edit action a read-only profile cannot accept is refused.
 *
 * The Core pseudo-entry and a MODULE's profile (bead wxut.6) are read-only for
 * different reasons, so the line says which one the GM is looking at: the book
 * is the book, and a module's profile is data the module shipped — the world
 * cannot rewrite it.
 */
function readOnlyEditRefusal(source: ProfileSource): readonly string[] {
	return source === "module"
		? [getPorts().i18n.t("RULES.MODULE_READONLY")]
		: ["the Core Rulebook is read-only — create a profile to store house rules"];
}

/** `RULES.PROFILE_DEFAULT_NAME` with the profile number filled in. */
function profileName(number: number): string {
	return getPorts().i18n.t("RULES.PROFILE_DEFAULT_NAME", {
		number: String(number),
	});
}

/** `RULES.PROFILE_COPY_NAME` with the source profile's name filled in. */
function copyName(source: string): string {
	return getPorts().i18n.t("RULES.PROFILE_COPY_NAME", { name: source });
}

/** Wire the profile-name input (one bound input per name per form). */
function wireProfileName(root: HTMLElement, onChange: (value: string) => void) {
	const input = root.querySelector<HTMLInputElement>("[data-profile-name]");
	if (!input || input.dataset.wired) return;
	input.dataset.wired = "1";
	input.addEventListener("input", () => onChange(input.value));
}

/** Wire the JSON tab's textarea. */
function wireJsonText(root: HTMLElement, onChange: (value: string) => void) {
	const area = root.querySelector<HTMLTextAreaElement>("[data-json]");
	if (!area || area.dataset.wired) return;
	area.dataset.wired = "1";
	area.addEventListener("input", () => onChange(area.value));
}

/**
 * Wire the pack tab's export scope select. A change re-renders because the
 * preview text IS the scope: the panel shows exactly what the Copy and
 * Download buttons would carry.
 */
function wirePackScope(
	root: HTMLElement,
	onChange: (scope: RulePackScope) => void,
) {
	const select = root.querySelector<HTMLSelectElement>("[data-pack-scope]");
	if (!select || select.dataset.wired) return;
	select.dataset.wired = "1";
	const apply = (): void => {
		const value = select.value;
		if (value === "active" || value === "all") onChange(value);
	};
	select.addEventListener("change", apply);
}

/** Wire the "activate the imported profile" checkbox. */
function wirePackActivate(
	root: HTMLElement,
	onChange: (checked: boolean) => void,
) {
	const box = root.querySelector<HTMLInputElement>("[data-pack-activate]");
	if (!box || box.dataset.wired) return;
	box.dataset.wired = "1";
	box.addEventListener("change", () => onChange(box.checked));
}

/** Wire the pack tab's import textarea. */
function wirePackText(root: HTMLElement, onChange: (value: string) => void) {
	const area = root.querySelector<HTMLTextAreaElement>("[data-pack-text]");
	if (!area || area.dataset.wired) return;
	area.dataset.wired = "1";
	area.addEventListener("input", () => onChange(area.value));
}

/**
 * Wire the pack tab's file picker. The picked file is READ into the textarea
 * (the notice says which file), so the text is what gets validated and the
 * single import path stays single. Not `wired`-guarded: picking a file twice
 * must re-read it.
 */
function wirePackFile(root: HTMLElement, onPick: (file: File) => unknown) {
	const input = root.querySelector<HTMLInputElement>("[data-pack-file]");
	if (!input) return;
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (file) onPick(file);
		// Reset so picking the SAME file twice fires change again.
		input.value = "";
	});
}
