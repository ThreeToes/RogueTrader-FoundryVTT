/**
 * Pure view model for the rules app (epic wxut, child B4).
 *
 * The rules app (presentation/rules-app.ts) is the ONLY editor for the named
 * house-rule profiles: the two settings that hold them are `config: false`, so
 * a GM can never hand-write a profile the app cannot render. Everything the
 * app decides — how the profile list derives (including the non-editable "Core"
 * pseudo-entry), which knob counts as OVERRIDDEN, what the core-vs-effective
 * diff contains, what the JSON tab accepts, what a profile action writes
 * back to the settings, and what a rules-pack import or export does — lives
 * here as PURE functions, so it is unit-testable
 * without a Foundry instance (owner ruling: logic only, no render-level
 * ApplicationV2 tests).
 *
 * The three rules this module exists to keep honest:
 *
 * 1. AN UNTOUCHED PROFILE IS CORE RULES. A knob the GM has not changed must be
 *    ABSENT from the delta, never present with the core value: deltaFromDraft
 *    drops every key whose value equals the knob's core value, so a duplicate
 *    of core is a cheap empty delta and mergeProfile returns the base profile
 *    object itself (the seam's identity guarantee, bead wxut.2).
 *
 * 2. NOTHING IS SILENTLY DROPPED. A hand-written key the registry does not
 *    describe survives deltaFromDraft untouched (an unknown key cannot be
 *    compared to a core value) and is then named by validateProfile, which the
 *    app surfaces in the UI. The tolerant decode below is only for values that
 *    are ALREADY STORED: decodeStoredProfiles keeps every well-formed row and
 *    reports the rest by position, never as a console-only message.
 *
 * 3. THE FORM IS GENERATED, NOT WRITTEN OUT. Every knob renders through the
 *    registry entry that describes it (knobGroupViews walks the registry it is
 *    given), so a new knob appears in the form, the diff and the coverage guard
 *    at once.
 *
 * WHOSE REGISTRY (bead w9sa.2): every registry read below takes the registry as
 * an argument and DEFAULTS to the ACTIVE system's (`ruleKnobs()` in
 * src/ffg/domain/rule-knobs.ts — Rogue Trader's until a sibling system
 * registers its own). Nothing here imports RT's `RULE_KNOBS` and nothing here
 * names an RT knob key: `tableKnobKey` even finds the whole-replacement table
 * knob from the registry's own `control`, so no system's key is a literal.
 */

import {	type KnobControl,
	type KnobGroup,
	type KnobHazard,
	knobByKey,
	mergeProfile,
	type ProfileDelta,
	RULE_KNOB_KEYS,
	ruleKnobRegistry,
	ruleKnobs,
	type RuleKnob,
	type RuleKnobRegistry,
	validateProfile,
} from "../../ffg/domain/rule-knobs";
import { rtCore, type SystemProfile } from "../../ffg/domain/system-profile";
import {
	ACTIVE_PROFILE_ID_SETTING,
	RULE_PROFILES_SETTING,
} from "../rules/homebrew";
import {
	type RuleProfilePackBase,
	type RuleProfilePackProfile,
	type RuleProfilePackRow,
	ruleProfilePackJson,
} from "../rules/rule-profile-pack";

/**
 * The pseudo-id of the "Core" list entry: CORE RULES, read from the profile
 * itself, never editable and never deletable. It is the same value
 * `activeProfileId` carries for core rules (""), so selecting Core in the list
 * and activating Core are the same fact seen from two ends.
 */
export const CORE_PROFILE_ID = "";

/**
 * The registry's WHOLE-REPLACEMENT table knob — the one the table editor binds
 * to. Found from the registry's own `control`, so no system's knob key is
 * written out here: RT's is "tables.hitLocations", a sibling system's is its
 * own, and a registry with no table knob has none (null) rather than a stale
 * RT key pointing at a knob that does not exist.
 */
export function tableKnobKey(
	registry: readonly RuleKnob[] = ruleKnobs(),
): string | null {
	return registry.find((knob) => knob.control === "table")?.key ?? null;
}

// ---------------------------------------------------------------------------
// Stored profiles (tolerant decode — already-stored values only)
// ---------------------------------------------------------------------------

/** One stored profile row, as the app edits it. */
export interface RuleProfileRow {
	readonly id: string;
	readonly name: string;
	readonly delta: ProfileDelta;
}

/**
 * One module-registered profile, as the app lists it (bead wxut.6, tier T2).
 *
 * Same row shape as a stored profile — the panels read a delta either way — but
 * its provenance is a module's init, so the app may only LOOK at it and
 * ACTIVATE it. It is held separately from `rows` for that reason: nothing the
 * app writes back may copy a module's delta into the world's profiles.
 */
export interface ModuleProfileRow {
	readonly id: string;
	readonly name: string;
	readonly delta: ProfileDelta;
}

/** Everything the rules app holds in memory. */
export interface RuleProfileState {
	readonly rows: readonly RuleProfileRow[];
	/** The active profile's id; "" (CORE_PROFILE_ID) means core rules. */
	readonly activeId: string;
	/**
	 * The profiles a MODULE registered at its own init (bead wxut.6, sharing
	 * tier T2). Absent when nothing registered any: the state the settings alone
	 * describe is unchanged, so the app and its callers do not grow a field to
	 * keep empty.
	 */
	readonly moduleProfiles?: readonly ModuleProfileRow[];
}

/** Why a stored profile row could not be read (localised by the app). */
export type SkippedProfileReason =
	| "not-a-list"
	| "not-a-row"
	| "no-id"
	| "no-delta";

/** One unreadable stored row: where it was, and why it was skipped. */
export interface SkippedProfileRow {
	/** 1-based position in the stored array (0 for a value-level failure). */
	readonly index: number;
	readonly reason: SkippedProfileReason;
}

/** The decode result plus a per-position report of what could not be read. */
export interface DecodedProfiles {
	readonly rows: readonly RuleProfileRow[];
	/**
	 * One entry per skipped row, named by position and reason — the app turns
	 * these into localised sentences, so they are surfaced in the UI rather
	 * than a console nobody reads.
	 */
	readonly skipped: readonly SkippedProfileRow[];
}

/** Decode a stored String setting holding JSON (or an object passed through). */
function decodeJson(stored: unknown): unknown {
	if (stored === null || stored === undefined) return null;
	if (typeof stored === "string") {
		const text = stored.trim();
		if (text === "") return null;
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return null;
		}
	}
	return typeof stored === "object" ? stored : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A row is `{id, delta}` with a string name; a missing name falls back to id. */
function toRow(entry: unknown): RuleProfileRow | SkippedProfileRow {
	if (!isRecord(entry)) return { index: 0, reason: "not-a-row" };
	const id = typeof entry.id === "string" ? entry.id.trim() : "";
	if (id === "") return { index: 0, reason: "no-id" };
	if (!isRecord(entry.delta)) return { index: 0, reason: "no-delta" };
	const name = typeof entry.name === "string" ? entry.name.trim() : "";
	return { id, name: name === "" ? id : name, delta: entry.delta };
}

/**
 * Decode the stored `ruleProfiles` value.
 *
 * TOLERANCE IS FOR ALREADY-STORED VALUES ONLY: a row that is not
 * `{id, name, delta}` is reported by position so the app can say so, and every
 * well-formed row is kept (a GM's hand-edited list is data, not an error). An
 * unparseable or non-array value yields no rows at all — that is core rules,
 * exactly as the lookup in rules/homebrew.ts reads it.
 */
export function decodeStoredProfiles(stored: unknown): DecodedProfiles {
	const decoded = decodeJson(stored);
	if (decoded === null) return { rows: [], skipped: [] };
	if (!Array.isArray(decoded)) {
		return { rows: [], skipped: [{ index: 0, reason: "not-a-list" }] };
	}
	const rows: RuleProfileRow[] = [];
	const skipped: SkippedProfileRow[] = [];
	for (const [index, entry] of decoded.entries()) {
		const row = toRow(entry);
		if ("id" in row) rows.push(row);
		else skipped.push({ index: index + 1, reason: row.reason });
	}
	return { rows, skipped };
}

/**
 * The stored settings as app state. An active id that names no row is CORE
 * RULES (the seam's rule, bead wxut.3): the app shows Core as active rather
 * than hiding a stale id behind a look that says nothing.
 *
 * A module-registered profile counts as a nameable row (bead wxut.6): an
 * active id pointing at one stays active, so a module's rules can be the
 * profile in force. Without the module list an unknown id is core rules.
 */
export function stateFromSettings(
	storedProfiles: unknown,
	activeProfileId: unknown,
	moduleProfiles: readonly ModuleProfileRow[] = [],
): RuleProfileState {
	const { rows } = decodeStoredProfiles(storedProfiles);
	const wanted =
		typeof activeProfileId === "string" ? activeProfileId.trim() : "";
	return {
		rows,
		activeId:
			rows.some((row) => row.id === wanted) ||
			moduleProfiles.some((row) => row.id === wanted)
				? wanted
				: "",
		...(moduleProfiles.length > 0 ? { moduleProfiles } : {}),
	};
}

// ---------------------------------------------------------------------------
// The profile list, with the Core pseudo-entry first
// ---------------------------------------------------------------------------

/** Where a listed profile came from: the book, the world, or a module. */
export type ProfileSource = "core" | "world" | "module";

/** One row of the app's profile list. */
export interface ProfileListEntry {
	readonly id: string;
	/** The stored name (rows only; the Core entry has none). */
	readonly name: string;
	/** i18n key for the entry's name — the Core entry, which has no name. */
	readonly nameKey: string | null;
	readonly isCore: boolean;
	/** Who owns this entry: the book, the world's settings, or a module. */
	readonly source: ProfileSource;
	/** Is this the profile the rules are running on. */
	readonly isActive: boolean;
	/** Only a stored row can be edited (its knobs, its name, its delta). */
	readonly canEdit: boolean;
	/** The Core Rulebook is not deletable. */
	readonly canDelete: boolean;
}

/** The stored profile rows that could not be read, as report rows. */
export function skippedProfilesFrom(
	stored: unknown,
): readonly SkippedProfileRow[] {
	return decodeStoredProfiles(stored).skipped;
}

/**
 * The profile list: the Core pseudo-entry first, then the stored rows in their
 * stored order. Core is never editable and never deletable — it IS the
 * Core Rulebook, not a stored row.
 */
export function profileList(
	state: RuleProfileState,
): readonly ProfileListEntry[] {
	const core: ProfileListEntry = {
		id: CORE_PROFILE_ID,
		name: "",
		nameKey: "RULES.PROFILE_CORE",
		isCore: true,
		source: "core",
		isActive: state.activeId === CORE_PROFILE_ID,
		canEdit: false,
		canDelete: false,
	};
	return [
		core,
		...state.rows.map((row) => ({
			id: row.id,
			name: row.name,
			nameKey: null,
			isCore: false,
			source: "world",
			isActive: row.id === state.activeId,
			canEdit: true,
			canDelete: true,
		}) satisfies ProfileListEntry),
	];
}

/**
 * The MODULE group's entries (bead wxut.6), listed under their own heading.
 *
 * READ-ONLY, and not subtly so: `canEdit` and `canDelete` are false, which is
 * what disables rename, duplicate, delete and save in the header, and there is
 * no module row anywhere in `state.rows`, so no action the app offers can
 * rewrite one. Selecting is allowed — a GM must be able to look at a module's
 * house rules — and so is ACTIVATION: the one write a module profile accepts is
 * the `activeProfileId` that puts it in force.
 *
 * A module id a world row ALSO owns is shadowed: `stateFromSettings` resolves
 * the world's row first, so the module entry is listed but never shown as
 * active — two rows wearing the active flag would be a lie about which rules
 * are running.
 */
export function moduleProfileEntries(
	state: RuleProfileState,
): readonly ProfileListEntry[] {
	const shadowed = state.rows.some((row) => row.id === state.activeId);
	return moduleProfilesOf(state).map(
		(row): ProfileListEntry => ({
			id: row.id,
			name: row.name,
			nameKey: null,
			isCore: false,
			source: "module",
			isActive: row.id === state.activeId && !shadowed,
			canEdit: false,
			canDelete: false,
		}),
	);
}

/** The module profiles of a state (empty when none registered any). */
export function moduleProfilesOf(
	state: RuleProfileState,
): readonly ModuleProfileRow[] {
	return state.moduleProfiles ?? [];
}

/** The stored row being edited, or null for the Core pseudo-entry. */
export function selectedRow(
	state: RuleProfileState,
	selectedId: string,
): RuleProfileRow | null {
	return state.rows.find((row) => row.id === selectedId) ?? null;
}

/**
 * What the selected id names, across the world's rows and the module group
 * (bead wxut.6). One answer for the app's two questions — may this be edited,
 * and what do the panels show — so a module profile can read as a profile
 * without ever becoming an editable one.
 */
export interface SelectedProfileView {
	/** The id names nothing (a stale selection): the app falls back to Core. */
	readonly known: boolean;
	readonly source: ProfileSource;
	/** The row's own name ("" for Core, which is shown by i18n key). */
	readonly name: string;
	readonly delta: ProfileDelta;
	/** True only for a WORLD row: knobs, name, delta, delete are all writable. */
	readonly editable: boolean;
}

export function selectedProfile(
	state: RuleProfileState,
	selectedId: string,
): SelectedProfileView {
	const row = selectedRow(state, selectedId);
	if (row) {
		return {
			known: true,
			source: "world",
			name: row.name,
			delta: row.delta,
			editable: true,
		};
	}
	const module = moduleProfilesOf(state).find((entry) => entry.id === selectedId);
	if (module) {
		return {
			known: true,
			source: "module",
			name: module.name,
			delta: module.delta,
			editable: false,
		};
	}
	return {
		known: false,
		source: "core",
		name: "",
		delta: {},
		editable: false,
	};
}

/**
 * The profile the rules are running on, as a list entry (Core when none).
 *
 * Searches the world's rows AND the module group, because a module profile in
 * force (bead wxut.6) is a profile in force: the header's active flag and the
 * app's "selected is active" test both read this.
 */
export function activeEntry(
	state: RuleProfileState,
): ProfileListEntry | undefined {
	return [
		...profileList(state),
		...moduleProfileEntries(state),
	].find((entry) => entry.isActive);
}

// ---------------------------------------------------------------------------
// Values: comparison and display
// ---------------------------------------------------------------------------

/** Deep-equal for knob values (scalars, records, arrays, null/undefined). */
export function knobValuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		a === null ||
		b === null ||
		a === undefined ||
		b === undefined ||
		typeof a !== "object" ||
		typeof b !== "object"
	) {
		return false;
	}
	const aArray = Array.isArray(a);
	if (aArray !== Array.isArray(b)) return false;
	if (aArray) {
		const other = b as readonly unknown[];
		return (
			a.length === other.length &&
			a.every((item, index) => knobValuesEqual(item, other[index]))
		);
	}
	const aObject = a as Record<string, unknown>;
	const bObject = b as Record<string, unknown>;
	const aKeys = Object.keys(aObject);
	if (aKeys.length !== Object.keys(bObject).length) return false;
	return aKeys.every(
		(key) =>
			Object.hasOwn(bObject, key) &&
			knobValuesEqual(aObject[key], bObject[key]),
	);
}

/**
 * A knob value as the app shows it: the template has no `format` helper (see
 * utils/template-helpers.ts), so every composition happens here and the
 * template only localises the few fixed labels.
 */
export interface KnobValueDisplay {
	/** No value at all (the nullable bands, an unset flat penalty). */
	readonly none: boolean;
	/** The value is a boolean (so `yesNo` is the value to show). */
	readonly isBoolean: boolean;
	/** Non-null for booleans, so the template can localise yes/no. */
	readonly yesNo: boolean | null;
	/** Plain text for numbers and select values. */
	readonly text: string;
	/** Band count for a table value (the rows are shown by the table control). */
	readonly bands: number;
}

export function knobValueDisplay(value: unknown): KnobValueDisplay {
	if (value === null || value === undefined) {
		return { none: true, isBoolean: false, yesNo: null, text: "", bands: 0 };
	}
	if (typeof value === "boolean") {
		return { none: false, isBoolean: true, yesNo: value, text: "", bands: 0 };
	}
	if (typeof value === "number") {
		return {
			none: false,
			isBoolean: false,
			yesNo: null,
			text: String(value),
			bands: 0,
		};
	}
	if (isRecord(value)) {
		return {
			none: false,
			isBoolean: false,
			yesNo: null,
			text: "",
			bands: Object.keys(value).length,
		};
	}
	return {
		none: false,
		isBoolean: false,
		yesNo: null,
		text: String(value),
		bands: 0,
	};
}

/** The value at a knob's path on a profile (undefined when the path is absent). */
export function readProfileValue(profile: unknown, knob: RuleKnob): unknown {
	let current: unknown = profile;
	for (const segment of knob.path) {
		if (!isRecord(current)) return undefined;
		current = current[segment];
	}
	return current;
}

// ---------------------------------------------------------------------------
// The generated knob form
// ---------------------------------------------------------------------------

/** One knob's row in the generated form. */
export interface KnobFieldView {
	readonly knob: RuleKnob;
	/** The registry section this knob is filed under. */
	readonly group: KnobGroup;
	readonly labelKey: string;
	readonly hintKey: string;
	/** The hazard-hint i18n key (RULES.HAZARD_*). */
	readonly hazardKey: string;
	readonly hazard: KnobHazard;
	readonly control: KnobControl;
	readonly options: readonly {
		readonly value: string;
		readonly labelKey: string;
		/** Is this option the one the control shows. */
		readonly selected: boolean;
	}[];
	readonly nullable: boolean;
	/** The Core Rulebook reference value, shown beside the control. */
	readonly coreValue: unknown;
	readonly coreDisplay: KnobValueDisplay;
	/** Is this control editable (false for the Core pseudo-entry). */
	readonly editable: boolean;
	/** The value the control holds (the pending edit, or core). */
	readonly value: unknown;
	readonly valueDisplay: KnobValueDisplay;
	/** Is a value stored for this key (before the "does it differ" test). */
	readonly inDelta: boolean;
	/** Does this knob carry a house rule in force (differs from core). */
	readonly overridden: boolean;
	/** The text a number/select control renders. */
	readonly inputValue: string;
	/** Whether a boolean control renders checked. */
	readonly checked: boolean;
	/** Band rows for the table control, as the template renders them. */
	readonly bandRows: readonly BandRowView[];
}

/** A knob section: the registry's `group`, its label, and its knobs in order. */
export interface KnobGroupView {
	readonly group: KnobGroup;
	readonly labelKey: string;
	readonly fields: readonly KnobFieldView[];
}

/** `RULES.GROUP_<GROUP>` for a registry group. */
export function groupLabelKey(group: KnobGroup): string {
	return `RULES.GROUP_${group.toUpperCase()}`;
}

/** `RULES.OPTION_<VALUE>` for a select option ("half-characteristic"). */
export function optionLabelKey(value: string): string {
	return `RULES.OPTION_${value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`;
}

/** `RULES.HAZARD_<HAZARD>` for a knob's hazard class. */
export function hazardKeyFor(hazard: KnobHazard): string {
	return `RULES.HAZARD_${hazard.toUpperCase().replaceAll("-", "_")}`;
}

/**
 * One knob's form row, from the knob's own registry entry plus the pending
 * draft value. Control-specific fields are derived here so the template holds
 * no per-control logic beyond a branch on `control`.
 *
 * `editable` is false exactly when the Core pseudo-entry is selected: the
 * Core Rulebook is shown as reference, never changed.
 */
export function knobFieldView(
	knob: RuleKnob,
	draft: ProfileDelta,
	editable: boolean,
): KnobFieldView {
	const raw = draft[knob.key];
	const inDelta = raw !== undefined;
	const value = inDelta ? raw : knob.coreValue;
	const coreDisplay = knobValueDisplay(knob.coreValue);
	const valueDisplay = knobValueDisplay(value);
	const options = (knob.options ?? []).map((option) => ({
		value: option,
		labelKey: optionLabelKey(option),
		selected: value === option,
	}));
	return {
		knob,
		group: knob.group,
		labelKey: knob.labelKey,
		hintKey: knob.hintKey,
		hazardKey: hazardKeyFor(knob.hazard),
		hazard: knob.hazard,
		control: knob.control,
		options,
		nullable: knob.nullable === true,
		coreValue: knob.coreValue,
		coreDisplay,
		value,
		valueDisplay,
		inDelta,
		overridden: inDelta && !knobValuesEqual(value, knob.coreValue),
		editable,
		inputValue:
			knob.control === "select" && typeof value === "string"
				? value
				: typeof value === "number"
					? String(value)
					: "",
		checked: value === true,
		bandRows: tableBandRows(value).map((row, index) => ({
			...row,
			index,
			knobKey: knob.key,
			editable,
		})),
	};
}

/** Every knob in registry order — the coverage guard's flattening. */
export function knobFields(
	draft: ProfileDelta,
	editable: boolean,
	registry: readonly RuleKnob[] = ruleKnobs(),
): readonly KnobFieldView[] {
	return registry.map((knob) => knobFieldView(knob, draft, editable));
}

/**
 * The generated form: the registry grouped by its own `group`, in registry
 * order, so a new knob lands in its section without touching this module.
 *
 * The registry defaults to the ACTIVE system's (RT's), so a sibling system's
 * knobs render through the same code with nothing but the binding changed.
 */
export function knobGroupViews(
	draft: ProfileDelta,
	editable: boolean,
	registry: readonly RuleKnob[] = ruleKnobs(),
): readonly KnobGroupView[] {
	const order: KnobGroup[] = [];
	const byGroup = new Map<KnobGroup, KnobFieldView[]>();
	for (const field of knobFields(draft, editable, registry)) {
		const existing = byGroup.get(field.group);
		if (existing) existing.push(field);
		else {
			byGroup.set(field.group, [field]);
			order.push(field.group);
		}
	}
	return order.map((group) => ({
		group,
		labelKey: groupLabelKey(group),
		fields: byGroup.get(group) ?? [],
	}));
}

/**
 * Every registry key, in registry order — the coverage pin: a test asserts
 * the generated form carries exactly these, so a new knob cannot fail to
 * render.
 */
export function knobFieldKeys(
	fields: readonly KnobFieldView[],
): readonly string[] {
	return fields.map((field) => field.knob.key);
}

// ---------------------------------------------------------------------------
// The pending draft -> the delta that gets stored
// ---------------------------------------------------------------------------

/**
 * Coerce a control's raw value into a delta value.
 *
 * A number field that holds text keeps the text: validateProfile then names
 * the key and the control ("expects a finite number, got the string ""12x"""),
 * so a typo is reported instead of silently becoming NaN or 0. An EMPTY number
 * field is undefined — absent key = core rule — which is also how the
 * nullable bands (no core value at all) are shown.
 */
export function coerceKnobInput(
	knob: RuleKnob,
	raw: string | boolean,
): unknown {
	if (knob.control === "boolean") {
		return typeof raw === "boolean" ? raw : raw === "true" || raw === "on";
	}
	if (knob.control !== "number") return raw;
	const text = typeof raw === "string" ? raw.trim() : "";
	if (text === "") return undefined;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : text;
}

/**
 * The delta a pending draft stores.
 *
 * Drops `undefined` (an empty field is an absent key) and drops every value
 * that EQUALS the knob's core value — "left at the core value" means the field
 * carries no house rule, so an untouched profile, a duplicate of core and a
 * knob reset back to core all yield the same empty delta. An UNKNOWN key is
 * kept as given: it cannot be compared to a core value, and dropping it here
 * would be the silent loss validateProfile exists to prevent (it names it).
 *
 * "Unknown" means unknown to the registry in force — the ACTIVE system's by
 * default, so a delta authored for a sibling system keeps its keys here and
 * is named by the validator rather than dropped.
 */
export function deltaFromDraft(
	draft: Readonly<Record<string, unknown>>,
	registry: readonly RuleKnob[] = ruleKnobs(),
): ProfileDelta {
	const delta: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(draft)) {
		if (value === undefined) continue;
		const knob = knobByKey(key, registry);
		if (knob && knobValuesEqual(value, knob.coreValue)) continue;
		delta[key] = value;
	}
	return delta;
}

// ---------------------------------------------------------------------------
// The whole-replacement hit-location table control
// ---------------------------------------------------------------------------

/** One band row of the table editor: "NN-NN" -> body location. */
export interface TableBandRow {
	readonly band: string;
	readonly location: string;
}

/**
 * One band row as the template renders it.
 *
 * The table control is the one place this app nests three Handlebars frames
 * (group -> field -> row), and a `../` walk at that depth is exactly the trap
 * bead 8aba pinned on the advancement dialog (a broken depth walk resolves to
 * undefined and the control silently mis-renders). So the row carries its own
 * index, its knob key and the editable flag instead: every lookup inside the
 * row loop is frame-direct.
 */
export interface BandRowView extends TableBandRow {
	readonly index: number;
	readonly knobKey: string;
	/** Read-only when the Core pseudo-entry is selected. */
	readonly editable: boolean;
}

/** The stored (or core) table as editor rows, in stored order. */
export function tableBandRows(value: unknown): readonly TableBandRow[] {
	if (!isRecord(value)) return [];
	return Object.entries(value).map(([band, location]) => ({
		band,
		location: typeof location === "string" ? location : String(location ?? ""),
	}));
}

/**
 * Editor rows as the table record the delta stores.
 *
 * A fully blank row (empty band AND empty location) is not a band and is
 * dropped; a row with either half filled is KEPT, so validateProfile can name
 * the malformed band or the missing location instead of the app quietly
 * discarding half a house rule.
 */
export function tableFromBandRows(
	rows: readonly TableBandRow[],
): Record<string, string> {
	const table: Record<string, string> = {};
	for (const row of rows) {
		const band = row.band.trim();
		const location = row.location.trim();
		if (band === "" && location === "") continue;
		table[band] = location;
	}
	return table;
}

/** Bands entered twice: a JSON object would keep only the last one. */
export function tableBandConflicts(
	rows: readonly TableBandRow[],
): readonly string[] {
	const seen = new Set<string>();
	const conflicts: string[] = [];
	for (const row of rows) {
		const band = row.band.trim();
		if (band === "") continue;
		if (seen.has(band)) conflicts.push(band);
		seen.add(band);
	}
	return conflicts;
}

// ---------------------------------------------------------------------------
// The diff panel: core vs effective
// ---------------------------------------------------------------------------

/** One row of the core-vs-effective diff. */
export interface ProfileDiffRow {
	readonly key: string;
	readonly labelKey: string | null;
	readonly hintKey: string | null;
	readonly hazard: KnobHazard | null;
	readonly hazardKey: string | null;
	/** The key is not in the registry (a hand-edited or legacy value). */
	readonly unknown: boolean;
	readonly coreValue: unknown;
	readonly coreDisplay: KnobValueDisplay;
	readonly effectiveValue: unknown;
	readonly effectiveDisplay: KnobValueDisplay;
	/** Does the stored value differ from the Core Rulebook value. */
	readonly overridden: boolean;
	/** A ledger-assuming knob that differs: existing characters are wrong. */
	readonly breaking: boolean;
}

/**
 * Core vs effective for a profile's delta: mergeProfile over the base profile
 * (rtCore) gives the effective side, and each stored key becomes a row. A
 * ledger-assuming knob that actually differs is marked BREAKING — the spent-xp
 * ledger of every existing character was built under the core value.
 *
 * An unknown key is a row with `unknown: true`: the merge cannot apply it (it
 * is named by validateProfile), and the diff saying so is the point.
 *
 * The registry defaults to the ACTIVE system's, so the diff is always against
 * the rules in force rather than against Rogue Trader's by accident.
 */
export function profileDiffRows<P extends object>(
	delta: ProfileDelta,
	registry: readonly RuleKnob[] = ruleKnobs(),
	base: P = rtCore as P,): readonly ProfileDiffRow[] {
	const accepted = validateProfile(registry, delta);
	const effective = mergeProfile(base, accepted.value, registry);
	const rows: ProfileDiffRow[] = [];
	for (const [key, value] of Object.entries(delta)) {
		if (value === undefined) continue;
		const knob = knobByKey(key, registry);
		if (!knob) {
			rows.push({
				key,
				labelKey: null,
				hintKey: null,
				hazard: null,
				hazardKey: null,
				unknown: true,
				coreValue: undefined,
				coreDisplay: knobValueDisplay(undefined),
				effectiveValue: value,
				effectiveDisplay: knobValueDisplay(value),
				overridden: true,
				breaking: false,
			});
			continue;
		}
		const coreValue = knob.coreValue;
		const effectiveValue = readProfileValue(effective, knob);
		const overridden = !knobValuesEqual(effectiveValue, coreValue);
		rows.push({
			key,
			labelKey: knob.labelKey,
			hintKey: knob.hintKey,
			hazard: knob.hazard,
			hazardKey: hazardKeyFor(knob.hazard),
			unknown: false,
			coreValue,
			coreDisplay: knobValueDisplay(coreValue),
			effectiveValue,
			effectiveDisplay: knobValueDisplay(effectiveValue),
			overridden,
			breaking: knob.hazard === "ledger-assuming" && overridden,
		});
	}
	return rows;
}

/** How many diff rows are BREAKING (0 means the diff is safe to apply). */
export function breakingDiffRowCount(rows: readonly ProfileDiffRow[]): number {
	return rows.filter((row) => row.breaking).length;
}

/** The profile the rules would run on: the base profile with the delta. */
export function effectiveProfileFor<P extends object>(
	delta: ProfileDelta,
	registry: readonly RuleKnob[] = ruleKnobs(),
	base: P = rtCore as P,
): P {
	return mergeProfile(base, delta, registry);
}

// ---------------------------------------------------------------------------
// The JSON tab: parse + validate, with every rejection named
// ---------------------------------------------------------------------------

/** What the JSON tab's text means after parsing and validation. */
export interface JsonTabResult {
	readonly ok: boolean;
	/** The accepted subset — never a silently-dropped key. */
	readonly delta: ProfileDelta;
	/** One message per problem, each naming the key it rejected. */
	readonly errors: readonly string[];
}

function describeJson(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	if (typeof value === "object") return "an object";
	return `the ${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Validate the JSON tab's text.
 *
 * Empty text means "no house rules" (an empty delta, stored as `{}`), which is
 * how a profile that carries nothing round-trips. A parse failure or a
 * non-object top level is reported without a key (there is none); every knob
 * level rejection comes from validateProfile and NAMES the key. The tolerant
 * parse (decodeJson) is only for values already in the setting — this path is
 * the GM typing, so it is strict.
 *
 * `registry` defaults to the ACTIVE system's, so the JSON tab accepts the
 * knobs the running system actually has — a knob from a sibling system is
 * reported by name instead of silently rejected against RT's list.
 */
export function jsonTabResult(
	text: string,
	registry: readonly RuleKnob[] = ruleKnobs(),
): JsonTabResult {
	const trimmed = text.trim();
	if (trimmed === "") return { ok: true, delta: {}, errors: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, delta: {}, errors: [`not valid JSON: ${message}`] };
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			delta: {},
			errors: [
				`the profile's JSON must be an object of knob key -> value, got ${describeJson(parsed)}`,
			],
		};
	}
	const validation = validateProfile(registry, parsed as ProfileDelta);
	return {
		ok: validation.valid,
		delta: validation.value,
		errors: validation.errors,
	};
}

/** The stored delta as the JSON tab's text (2-space, so it is readable). */
export function jsonTabText(delta: ProfileDelta): string {
	return JSON.stringify(delta, null, 2);
}

// ---------------------------------------------------------------------------
// Profile actions and the write-back
// ---------------------------------------------------------------------------

/**
 * What a profile-management action does to the stored state. Every action is a
 * pure reducer over the whole state, so the app's save path is one function and
 * the settings writes are testable without a Foundry instance.
 */
export type RuleProfileAction =
	/** Make a row (or Core) the profile the rules run on. */
	| { readonly kind: "activate"; readonly id: string }
	/** Append an empty profile (the caller supplies id + name). */
	| { readonly kind: "create"; readonly id: string; readonly name: string }
	/** Append a copy of a row's delta under a new id + name. */
	| {
			readonly kind: "duplicate";
			readonly id: string;
			readonly newId: string;
			readonly name: string;
	  }
	/** Rename a row. */
	| { readonly kind: "rename"; readonly id: string; readonly name: string }
	/** Replace a row's delta (validated by the caller before it gets here). */
	| {
			readonly kind: "saveDelta";
			readonly id: string;
			readonly delta: ProfileDelta;
	  }
	/** Delete a row; deleting the ACTIVE row falls back to core rules. */
	| { readonly kind: "delete"; readonly id: string };

/** The next free "profile" id ("profile", "profile-2", "profile-3", ...). */
export function nextProfileId(
	rows: readonly RuleProfileRow[],
	moduleProfiles: readonly ModuleProfileRow[] = [],
): string {
	const used = new Set([
		...rows.map((row) => row.id),
		...moduleProfiles.map((row) => row.id),
	]);
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? "profile" : `profile-${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

/**
 * Map one row, or return the state UNCHANGED when the id names no row —
 * the app tells a refusal from a success by reference (`next === state`), so a
 * no-op must not manufacture an equal-but-new state.
 */
function withRow(
	state: RuleProfileState,
	id: string,
	update: (row: RuleProfileRow) => RuleProfileRow,
): RuleProfileState {
	if (!state.rows.some((row) => row.id === id)) return state;
	return {
		...state,
		rows: state.rows.map((row) => (row.id === id ? update(row) : row)),
	};
}

/**
 * Apply a profile-management action. Refusals are NOT silent: each one leaves
 * the state untouched, which the app turns into a visible notice (Core cannot
 * be renamed or deleted; an unknown id changes nothing; an empty name is not a
 * name). Deleting the ACTIVE profile falls back to core rules, because a
 * dangling active id is core rules anyway (stateFromSettings).
 *
 * ACTIVATION is the one module profile accepts (bead wxut.6): the module group
 * is a valid target, because putting a module's house rules in force is
 * exactly `activeProfileId` and NOTHING else — the write below still carries
 * only the world's rows, so a module's delta is never copied into them. Every
 * other action still refuses a module id, which is what read-only means.
 */
export function applyProfileAction(
	state: RuleProfileState,
	action: RuleProfileAction,
): RuleProfileState {
	switch (action.kind) {
		case "activate":
			if (
				action.id !== CORE_PROFILE_ID &&
				!state.rows.some((row) => row.id === action.id) &&
				!moduleProfilesOf(state).some((row) => row.id === action.id)
			) {
				return state;
			}
			return { ...state, activeId: action.id };
		case "create":
			return {
				...state,
				rows: [...state.rows, { id: action.id, name: action.name, delta: {} }],
			};
		case "duplicate": {
			const source = state.rows.find((row) => row.id === action.id);
			if (!source) return state;
			return {
				...state,
				rows: [
					...state.rows,
					{ id: action.newId, name: action.name, delta: { ...source.delta } },
				],
			};
		}
		case "rename": {
			if (action.id === CORE_PROFILE_ID) return state;
			const name = action.name.trim();
			if (name === "") return state;
			return withRow(state, action.id, (row) => ({ ...row, name }));
		}
		case "saveDelta": {
			if (action.id === CORE_PROFILE_ID) return state;
			if (!state.rows.some((row) => row.id === action.id)) return state;
			return withRow(state, action.id, (row) => ({
				...row,
				delta: action.delta,
			}));
		}
		case "delete": {
			if (action.id === CORE_PROFILE_ID) return state;
			if (!state.rows.some((row) => row.id === action.id)) return state;
			return {
				rows: state.rows.filter((row) => row.id !== action.id),
				activeId:
					state.activeId === action.id ? CORE_PROFILE_ID : state.activeId,
			};
		}
	}
}

/** The two settings keys the app writes, as a pair. */
export const RULE_PROFILE_WRITE_KEYS = [
	RULE_PROFILES_SETTING,
	ACTIVE_PROFILE_ID_SETTING,
] as const;

/** What one persist writes: the whole array, plus the active id. */
export interface RuleProfileWrite {
	readonly ruleProfiles: string;
	readonly activeProfileId: string;
}

/**
 * Serialise the state into the two setting values. The array is ALWAYS valid
 * JSON (an empty list is `[]`, never the blank default), so a GM reading the
 * setting sees exactly what the app holds.
 *
 * MODULE PROFILES ARE NOT IN IT (bead wxut.6): they live in their own field, so
 * this write cannot copy a module's delta into the world's profiles — the
 * world keeps owning only what a GM typed, and a module's house rules stay a
 * delta the module shipped rather than becoming world data.
 */
export function ruleProfileWrite(state: RuleProfileState): RuleProfileWrite {
	return {
		ruleProfiles: JSON.stringify(
			state.rows.map((row) => ({
				id: row.id,
				name: row.name,
				delta: row.delta,
			})),
		),
		activeProfileId: state.activeId,
	};
}

/** The slice of the settings surface a write needs. */
export interface RuleProfileWriteSurface {
	set(ns: string, key: string, value: unknown): unknown;
}

/**
 * Write the two settings.
 *
 * Both keys go together, in one pass, so a half-updated pair cannot exist: the
 * array and the active id describing different profiles would be worse than
 * either write failing. A rejected write never escapes (a read-only world must
 * not throw out of a button handler) — it is reported through `warn`.
 */
export function persistRuleProfiles(
	surface: RuleProfileWriteSurface,
	ns: string,
	write: RuleProfileWrite,
	warn: (error: unknown) => void,
): void {
	const values: Readonly<Record<string, string>> = {
		[RULE_PROFILES_SETTING]: write.ruleProfiles,
		[ACTIVE_PROFILE_ID_SETTING]: write.activeProfileId,
	};
	for (const key of RULE_PROFILE_WRITE_KEYS) {
		try {
			// Foundry's set returns a Promise; the repo idiom is a bare .catch
			// (see bootstrap/config.ts#clearLegacyHomebrewSetting).
			Promise.resolve(surface.set(ns, key, values[key])).catch(warn);
		} catch (error) {
			warn(error);
		}
	}
}

/**
 * Every registry key — the coverage guard's expectation for the form.
 *
 * RT's own list, deliberately NOT the active registry's: this is the pin that
 * RT's shipped form renders every knob RT ships, and it is evaluated once at
 * import (before any sibling system could register). A sibling system's own
 * bead pins its registry the same way over its own list.
 */
export const REGISTRY_KNOB_KEYS: readonly string[] = RULE_KNOB_KEYS;

// ---------------------------------------------------------------------------
// Rules pack import/export (bead wxut.5)
// ---------------------------------------------------------------------------

/**
 * Sharing a house rule is a FILE, not a story about where to click. The two
 * halves of it live here as pure decisions so the app's buttons are thin:
 * which rows a scope exports, what the merge an import performs will do, and
 * what the download is called. The pack FORMAT itself — kind, schema version,
 * the guards, the loud refusals — is rules/rule-profile-pack.ts, which never
 * knows this module exists.
 */

/** What an export writes: the profile in force, or every stored profile. */
export type RulePackScope = "active" | "all";

/**
 * The rows a scope exports. Active-only is EMPTY while core rules are in force:
 * there is no house rule to share, and the panel says so rather than shipping a
 * pack with an empty `profiles` array that imports as nothing.
 *
 * A MODULE profile in force exports nothing either (bead wxut.6): the pack is
 * how the world's own profiles travel, and exporting a module's delta would be
 * the duplicate action the read-only group withholds — the module is the
 * sharing route for its own rules.
 */
export function packExportRows(
	state: RuleProfileState,
	scope: RulePackScope,
): readonly RuleProfileRow[] {
	if (scope === "all") return state.rows;
	const active = selectedRow(state, state.activeId);
	return active ? [active] : [];
}

/**
 * The pack's JSON text: the same 2-space shape as the JSON tab, so a GM reading
 * either one sees the same formatting.
 *
 * `base` is filled in by the caller from the RUNNING system (profile id +
 * version): the pure layer must not reach for Foundry to learn what it is
 * running on. The `kind` comes from the registry in force, so an export is
 * stamped with the system that authored it.
 */
export function packExportText(
	rows: readonly RuleProfilePackRow[],
	base: RuleProfilePackBase,
	registry: RuleKnobRegistry = ruleKnobRegistry(),
): string {
	return ruleProfilePackJson(rows, base, registry);
}

/** One profile the import would replace: same id, different house rules. */
export interface PackImportClash {
	readonly id: string;
	/** The name the world already knows this id by. */
	readonly existingName: string;
	/** The name the pack gives it. */
	readonly incomingName: string;
}

/**
 * What an import will do, decided BEFORE the app asks anything.
 *
 * The actions are ordinary profile actions applied in order, so an import
 * cannot invent a second write path: it creates the new rows, replaces the
 * clashing ones (name AND delta — an overwrite is an overwrite, not a delta
 * merge) and optionally activates the one profile that came in.
 */
export interface PackImportPlan {
	readonly actions: readonly RuleProfileAction[];
	/** Rows appended — ids the world did not have. */
	readonly added: readonly RuleProfileRow[];
	/** Same-id profiles the import replaces; the app confirms these. */
	readonly clashes: readonly PackImportClash[];
	/**
	 * May the imported profile be made active? Exactly ONE profile imported:
	 * with several, "activate it" would be a guess about which one the GM
	 * meant, so the app says to pick from the list instead.
	 */
	readonly canActivate: boolean;
	/** The id to activate when the GM asks for it (null when ambiguous). */
	readonly activateId: string | null;
}

/**
 * Plan an import of an ALREADY-VALIDATED pack. The parser is what guarantees
 * the deltas are knob data; this only decides how they meet the stored list.
 */
export function packImportPlan(
	state: RuleProfileState,
	profiles: readonly RuleProfilePackProfile[],
	activate = false,
): PackImportPlan {
	const actions: RuleProfileAction[] = [];
	const added: RuleProfileRow[] = [];
	const clashes: PackImportClash[] = [];
	for (const profile of profiles) {
		const existing = selectedRow(state, profile.id);
		if (existing) {
			clashes.push({
				id: profile.id,
				existingName: existing.name,
				incomingName: profile.name,
			});
			actions.push({ kind: "rename", id: profile.id, name: profile.name });
			actions.push({ kind: "saveDelta", id: profile.id, delta: profile.delta });
			continue;
		}
		added.push({ id: profile.id, name: profile.name, delta: profile.delta });
		actions.push({ kind: "create", id: profile.id, name: profile.name });
		actions.push({ kind: "saveDelta", id: profile.id, delta: profile.delta });
	}
	const canActivate = profiles.length === 1;
	if (activate && canActivate) {
		actions.push({ kind: "activate", id: profiles[0]!.id });
	}
	return {
		actions,
		added,
		clashes,
		canActivate,
		activateId: canActivate ? profiles[0]!.id : null,
	};
}

/** Fold a plan's actions over the state (applyProfileAction in order). */
export function packImportState(
	state: RuleProfileState,
	plan: PackImportPlan,
): RuleProfileState {
	return plan.actions.reduce<RuleProfileState>(applyProfileAction, state);
}

/** A GM's profile name as a filename fragment: "Silly burst" -> "silly-burst". */
export function packSlug(name: string): string {
	const slug = name
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
	return slug === "" ? "profile" : slug;
}
