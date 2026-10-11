/**
 * Pure view-model tests for the rules app (epic wxut, child B4).
 *
 * Owner ruling: logic only — there are no render-level ApplicationV2 tests in
 * this repo. So every decision the app makes lives in
 * presentation/rules-view-model.ts and is pinned HERE: the profile list
 * derivation (including the non-editable Core pseudo-entry), knob override
 * detection, the JSON tab's validate round trip, the core-vs-effective diff,
 * the profile-action reducers and what each one writes back to the settings.
 *
 * The three invariants these guards exist to keep:
 *   1. an untouched profile is CORE RULES (an empty delta);
 *   2. nothing is silently dropped — an unknown key is named, not dropped;
 *   3. the form is generated — every registry knob is covered by the view
 *      model, so a new knob cannot fail to render.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	knobByKey,
	registerRuleKnobRegistry,
	resetRuleKnobRegistryForTests,
	type RuleKnob,
	type RuleKnobRegistry,
	RULE_KNOBS,
	RULE_KNOB_KEYS,
	ruleKnobRegistry,
	type ProfileDelta,
} from "../../ffg/domain/rule-knobs";
import { rtCore } from "../../ffg/domain/system-profile";
import { parseRuleProfilePack } from "../rules/rule-profile-pack";
import {
	activeEntry,
	applyProfileAction,
	breakingDiffRowCount,
	CORE_PROFILE_ID,
	coerceKnobInput,
	decodeStoredProfiles,
	deltaFromDraft,
	effectiveProfileFor,
	groupLabelKey,
	hazardKeyFor,
	jsonTabResult,
	jsonTabText,
	knobFieldKeys,
	knobFields,
	knobGroupViews,
	knobValuesEqual,
	nextProfileId,
	optionLabelKey,
	packExportRows,
	packExportText,
	packImportPlan,
	packImportState,
	packSlug,
	persistRuleProfiles,
	profileDiffRows,
	profileList,
	readProfileValue,
	REGISTRY_KNOB_KEYS,
	ruleProfileWrite,
	RULE_PROFILE_WRITE_KEYS,
	selectedRow,
	skippedProfilesFrom,
	stateFromSettings,
	tableBandConflicts,
	tableBandRows,
	tableFromBandRows,
	tableKnobKey,
	type RuleProfileRow,
	type RuleProfileState,
} from "./rules-view-model";

// --- helpers --------------------------------------------------------------

function row(
	id: string,
	name = id.toUpperCase(),
	delta: ProfileDelta = {},
): RuleProfileRow {
	return { id, name, delta };
}

function state(
	rows: readonly RuleProfileRow[],
	activeId = "",
): RuleProfileState {
	return { rows, activeId };
}

/** A write log: one entry per set() call, plus the rejections reported. */
interface WriteHarness {
	writes: Array<{ key: string; value: unknown }>;
	rejections: unknown[];
	surface: { set(ns: string, key: string, value: unknown): Promise<unknown> };
}

function writeHarness(): WriteHarness {
	const writes: Array<{ key: string; value: unknown }> = [];
	const rejections: unknown[] = [];
	return {
		writes,
		rejections,
		surface: {
			set: (_ns: string, key: string, value: unknown) => {
				writes.push({ key, value });
				return Promise.resolve(value);
			},
		},
	};
}

/** Report a problem (test-only sink mirroring the app's console.warn). */
function reportInto(harness: WriteHarness): (error: unknown) => void {
	return (error: unknown) => harness.rejections.push(error);
}

/** A stored profiles value: JSON text, exactly as the String setting holds it. */
function stored(rows: readonly RuleProfileRow[]): string {
	return JSON.stringify(
		rows.map((r) => ({ id: r.id, name: r.name, delta: r.delta })),
	);
}

// --- the profile list and the Core pseudo-entry ---------------------------

describe("profile list (core pseudo-entry first)", () => {
	test("Core is listed first, is never active-editable and is never deletable", () => {
		const list = profileList(state([row("a")], "a"));
		expect(list).toHaveLength(2);
		const core = list[0]!;
		expect(core.id).toBe(CORE_PROFILE_ID);
		expect(core.isCore).toBe(true);
		expect(core.canEdit).toBe(false);
		expect(core.canDelete).toBe(false);
		// Core shows nobody's stored name: its label is an i18n key.
		expect(core.nameKey).toBe("RULES.PROFILE_CORE");
		expect(core.isActive).toBe(false);
	});

	test("Core is the active entry when activeProfileId is empty", () => {
		const list = profileList(state([row("a")], ""));
		expect(list[0]!.isActive).toBe(true);
		expect(activeEntry(state([row("a")], ""))?.id).toBe(CORE_PROFILE_ID);
	});

	test("stored rows keep their order and carry their own names", () => {
		const list = profileList(state([row("z", "Zulu"), row("a", "Alpha")]));
		expect(list.map((entry) => entry.id)).toEqual(["", "z", "a"]);
		expect(list[1]!.name).toBe("Zulu");
		expect(list[1]!.nameKey).toBeNull();
		expect(list[1]!.canEdit).toBe(true);
		expect(list[1]!.canDelete).toBe(true);
	});

	test("a stale active id (a row that is gone) reads as core rules", () => {
		// stateFromSettings normalises the id; a state built by hand is allowed
		// to carry a dangling one, which nothing reads as active.
		const active = activeEntry(
			stateFromSettings(stored([row("a")]), "deleted-row"),
		);
		expect(active?.id).toBe(CORE_PROFILE_ID);
	});
});

// --- tolerant decode of already-stored values -----------------------------

describe("decodeStoredProfiles (tolerance is for ALREADY-STORED values)", () => {
	test("JSON text and a passed-through object decode the same way", () => {
		const rows = [row("a", "A", { "ammo.autoConsume": true })];
		expect(decodeStoredProfiles(stored(rows)).rows).toEqual(rows);
		expect(decodeStoredProfiles(JSON.parse(stored(rows))).rows).toEqual(rows);
	});

	test("nothing stored, an empty string and an empty list all mean no rows", () => {
		for (const value of ["", null, undefined, "[]"]) {
			expect(decodeStoredProfiles(value).rows).toEqual([]);
			expect(decodeStoredProfiles(value).skipped).toEqual([]);
		}
	});

	test("an unparseable or non-array value yields no rows and one report", () => {
		expect(decodeStoredProfiles("not json").rows).toEqual([]);
		expect(decodeStoredProfiles('{"id":"a"}').skipped).toEqual([
			{ index: 0, reason: "not-a-list" },
		]);
	});

	test("a malformed row is reported BY POSITION, never silently dropped", () => {
		const decoded = decodeStoredProfiles(
			JSON.stringify([
				{ id: "ok", name: "OK", delta: {} },
				{ name: "no id", delta: {} },
				{ id: "b", name: "B" }, // no delta
				{ id: 7, name: "N", delta: {} }, // non-string id
				["a", {}], // an array row
			]),
		);
		expect(decoded.rows.map((r) => r.id)).toEqual(["ok"]);
		// One report per bad row, each naming its 1-based position and why.
		expect(decoded.skipped).toEqual([
			{ index: 2, reason: "no-id" },
			{ index: 3, reason: "no-delta" },
			{ index: 4, reason: "no-id" },
			{ index: 5, reason: "not-a-row" },
		]);
	});

	test("a row with no name falls back to its id (a name is not required)", () => {
		expect(decodeStoredProfiles('[{"id":"a","delta":{}}]').rows).toEqual([
			{ id: "a", name: "a", delta: {} },
		]);
	});

	test("the app surfaces the skipped rows rather than hiding them", () => {
		expect(skippedProfilesFrom('[{"id":"a"}]')).toEqual([
			{ index: 1, reason: "no-delta" },
		]);
		expect(skippedProfilesFrom(stored([row("a")]))).toEqual([]);
	});
});

describe("stateFromSettings", () => {
	test("an active id that names no row is core rules", () => {
		expect(stateFromSettings(stored([row("a")]), "nope")).toEqual(
			state([row("a")], ""),
		);
	});

	test("a non-string active id is core rules", () => {
		for (const activeProfileId of [null, undefined, 7, {}]) {
			expect(
				stateFromSettings(stored([row("a")]), activeProfileId).activeId,
			).toBe("");
		}
	});

	test("the named row is the active one", () => {
		expect(
			stateFromSettings(stored([row("a"), row("b")]), " b ").activeId,
		).toBe("b");
	});
});

// --- the generated knob form ---------------------------------------------

describe("the generated knob form", () => {
	test("every registry knob renders exactly once, through its own control", () => {
		const fields = knobFields({}, true);
		expect(fields.map((f) => f.knob.key)).toEqual([...RULE_KNOB_KEYS]);
		for (const field of fields) {
			// The field is built FROM the registry entry, not a parallel table:
			// control, options, hazard and keys all come straight from it.
			expect(field.control).toBe(field.knob.control);
			expect(field.labelKey).toBe(field.knob.labelKey);
			expect(field.hintKey).toBe(field.knob.hintKey);
			expect(field.hazardKey).toBe(hazardKeyFor(field.hazard));
			expect(field.hazard).toBe(field.knob.hazard);
			// A select control carries one labelled option per allowed value.
			if (field.control === "select") {
				expect(field.options.map((o) => o.value)).toEqual([
					...(field.knob.options ?? []),
				]);
				for (const option of field.options) {
					expect(option.labelKey).toBe(optionLabelKey(option.value));
				}
			}
		}
	});

	test("the coverage guard pins the registry, not a hand-written list", () => {
		expect(REGISTRY_KNOB_KEYS).toHaveLength(RULE_KNOBS.length);
		for (const key of REGISTRY_KNOB_KEYS) expect(knobByKey(key)).toBeDefined();
		// The generated form carries exactly the registry's keys, in order: a
		// knob nobody wired up fails here instead of silently not rendering.
		expect(knobFieldKeys(knobFields({}, true))).toEqual([
			...REGISTRY_KNOB_KEYS,
		]);
	});

	test("every control kind the template renders has a knob behind it", () => {
		const controls = new Set(knobFields({}, true).map((f) => f.control));
		// number input, checkbox, select, and the hit-location table editor.
		expect([...controls].sort()).toEqual([
			"boolean",
			"number",
			"select",
			"table",
		]);
	});

	test("knobs are grouped by their registry group, in registry order", () => {
		const groups = knobGroupViews({}, true);
		const expectedOrder: string[] = [];
		for (const knob of RULE_KNOBS) {
			if (!expectedOrder.includes(knob.group)) expectedOrder.push(knob.group);
		}
		expect(groups.map((g) => g.group)).toEqual(expectedOrder);
		expect(groups.map((g) => g.labelKey)).toEqual(
			expectedOrder.map((g) => groupLabelKey(g as never)),
		);
		// Flat count still matches the registry (a knob cannot vanish into a
		// group and stay uncounted).
		expect(groups.flatMap((g) => g.fields)).toHaveLength(RULE_KNOBS.length);
	});

	test("an empty draft shows every knob at its CORE value, nothing overridden", () => {
		for (const field of knobFields({}, true)) {
			expect(field.inDelta).toBe(false);
			expect(field.overridden).toBe(false);
			expect(field.value).toBe(field.knob.coreValue);
		}
	});

	test("the core reference is displayed, including the 'no core value' case", () => {
		const fields = new Map(knobFields({}, true).map((f) => [f.knob.key, f]));
		// A number with a core value prints the number.
		expect(fields.get("combat.fireModeBonus.burst")!.coreDisplay.text).toBe(
			"10",
		);
		expect(fields.get("combat.fireModeBonus.burst")!.coreDisplay.none).toBe(
			false,
		);
		// A boolean prints yes/no, not the raw literal.
		expect(fields.get("ammo.autoConsume")!.coreDisplay.isBoolean).toBe(true);
		expect(fields.get("ammo.autoConsume")!.coreDisplay.yesNo).toBe(false);
		// The RT core profile stores NO flat penalty at all.
		expect(fields.get("skills.untrainedSkill.penalty")!.coreDisplay.none).toBe(
			true,
		);
		// The table shows a band count (its rows come from the control).
		expect(fields.get("tables.hitLocations")!.coreDisplay.bands).toBe(6);
	});

	test("a knob the GM changed is OVERRIDDEN; one left at core is not", () => {
		const fields = knobFields(
			{ "combat.fireModeBonus.burst": 0, "ammo.autoConsume": false },
			true,
		);
		const byKey = new Map(fields.map((f) => [f.knob.key, f]));
		expect(byKey.get("combat.fireModeBonus.burst")!.overridden).toBe(true);
		// Explicitly set to the core value: stored, but no rule in force.
		expect(byKey.get("ammo.autoConsume")!.inDelta).toBe(true);
		expect(byKey.get("ammo.autoConsume")!.overridden).toBe(false);
	});

	test("the Core pseudo-entry is rendered read-only", () => {
		const fields = knobFields({}, false);
		expect(fields.every((f) => f.editable === false)).toBe(true);
		expect(fields.every((f) => f.bandRows.every((r) => !r.editable))).toBe(
			true,
		);
	});
});

// --- override detection: "explicitly changed vs core" ---------------------

describe("deltaFromDraft — a field left at the core value is absent", () => {
	test("an untouched profile yields an EMPTY delta (so it is core rules)", () => {
		// The whole registry, every knob at its core value: nothing to store.
		const draft: Record<string, unknown> = {};
		for (const knob of RULE_KNOBS) draft[knob.key] = knob.coreValue;
		expect(deltaFromDraft(draft)).toEqual({});
	});

	test("an undefined value (an empty field) is an absent key", () => {
		expect(
			deltaFromDraft({
				"combat.fireModeBonus.burst": 5,
				"test.autoFailRoll": undefined,
			}),
		).toEqual({ "combat.fireModeBonus.burst": 5 });
	});

	test("an UNKNOWN key survives the draft so the validator can name it", () => {
		// Dropping it here would be the silent loss validateProfile prevents.
		const delta = deltaFromDraft({
			"combat.fireModeBonus.burst": 10,
			bogus: 1,
		});
		expect(delta).toEqual({ bogus: 1 });
	});

	test("an object knob merges leaf-wise: changing one sibling keeps the other", () => {
		const delta = deltaFromDraft({ "psychic.pushCap.other": 6 });
		expect(delta).toEqual({ "psychic.pushCap.other": 6 });
		// The merged profile still carries the core sanctioned cap.
		expect(effectiveProfileFor(delta).pushCap).toEqual({
			...rtCore.pushCap,
			other: 6,
		});
	});
});

describe("coerceKnobInput — a typo is reported, never coerced to 0", () => {
	const numberKnob = knobByKey("combat.fireModeBonus.burst")!;
	const boolKnob = knobByKey("ammo.autoConsume")!;
	const selectKnob = knobByKey("skills.untrainedSkill.model")!;

	test("an empty number field is undefined (absent key = core rule)", () => {
		expect(coerceKnobInput(numberKnob, "")).toBeUndefined();
		expect(coerceKnobInput(numberKnob, "   ")).toBeUndefined();
	});

	test("a number field keeps its text so validateProfile names the key", () => {
		expect(coerceKnobInput(numberKnob, "12x")).toBe("12x");
		expect(coerceKnobInput(numberKnob, " 15 ")).toBe(15);
	});

	test("checkboxes give a boolean, selects pass their string through", () => {
		expect(coerceKnobInput(boolKnob, true)).toBe(true);
		expect(coerceKnobInput(boolKnob, "on")).toBe(true);
		expect(coerceKnobInput(boolKnob, "false")).toBe(false);
		expect(coerceKnobInput(selectKnob, "flat-penalty")).toBe("flat-penalty");
	});

	test("a coerced typo is REFUSED by validateProfile with the key named", () => {
		const result = jsonTabResult(
			jsonTabText({
				"combat.fireModeBonus.burst": coerceKnobInput(numberKnob, "12x"),
			}),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join()).toContain("combat.fireModeBonus.burst");
		expect(result.errors.join()).toContain("finite number");
	});
});

// --- the whole-replacement hit-location table -----------------------------

describe("the hit-location table control (whole replacement, band keying kept)", () => {
	test("the core table's bands are read in stored order, exactly as keyed", () => {
		expect(tableBandRows(rtCore.hitLocations)).toEqual([
			{ band: "01-10", location: "head" },
			{ band: "11-20", location: "right-arm" },
			{ band: "21-30", location: "left-arm" },
			{ band: "31-70", location: "body" },
			{ band: "71-85", location: "right-leg" },
			{ band: "86-00", location: "left-leg" },
		]);
	});

	test("a non-table value (a hand-typed string) yields no rows", () => {
		expect(tableBandRows("86-00")).toEqual([]);
		expect(tableBandRows(null)).toEqual([]);
	});

	test("a fully blank row is not a band, but a HALF-filled one is kept", () => {
		// Kept so the validator can name the malformed band instead of the app
		// quietly discarding half a house rule.
		expect(
			tableFromBandRows([
				{ band: "", location: "" },
				{ band: "86-00", location: "" },
				{ band: "01-10", location: "head" },
			]),
		).toEqual({ "86-00": "", "01-10": "head" });
	});

	test("a malformed band and a missing location are both named", () => {
		// validateProfile reports the first problem in a table, so each shape is
		// checked on its own: the point is that BOTH are named, not that both
		// arrive in one message.
		const malformed = jsonTabResult(
			jsonTabText({
				"tables.hitLocations": tableFromBandRows([
					{ band: "86-1", location: "left-leg" },
					{ band: "01-10", location: "head" },
				]),
			}),
		);
		expect(malformed.ok).toBe(false);
		expect(malformed.errors[0]).toContain('malformed band "86-1"');
		const emptyLocation = jsonTabResult(
			jsonTabText({
				"tables.hitLocations": tableFromBandRows([
					{ band: "01-10", location: "" },
				]),
			}),
		);
		expect(emptyLocation.ok).toBe(false);
		expect(emptyLocation.errors[0]).toContain("must name a body location");
	});

	test("a band entered twice is reported before the JSON collapses it", () => {
		expect(
			tableBandConflicts([
				{ band: "01-10", location: "head" },
				{ band: "01-10", location: "body" },
				{ band: "", location: "" },
			]),
		).toEqual(["01-10"]);
		expect(tableBandConflicts([{ band: "01-10", location: "head" }])).toEqual(
			[],
		);
	});

	test("an empty table is a legal whole replacement (unmatched rolls fall back to body)", () => {
		const result = jsonTabResult(
			jsonTabText({ "tables.hitLocations": tableFromBandRows([]) }),
		);
		expect(result.ok).toBe(true);
		expect(result.delta).toEqual({ "tables.hitLocations": {} });
	});
});

// --- the JSON tab ---------------------------------------------------------

describe("the JSON tab: parse + validate, every rejection named", () => {
	test("a valid delta round-trips", () => {
		const delta = {
			"combat.fireModeBonus.burst": 0,
			"ammo.autoConsume": true,
			"skills.untrainedSkill.model": "flat-penalty",
			"tables.hitLocations": { "86-00": "left-leg" },
		};
		const result = jsonTabResult(jsonTabText(delta));
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.delta).toEqual(delta);
	});

	test("empty text means no house rules", () => {
		for (const text of ["", "   ", "\n"]) {
			const result = jsonTabResult(text);
			expect(result.ok).toBe(true);
			expect(result.delta).toEqual({});
		}
	});

	test("invalid JSON is reported with the parser's reason", () => {
		const result = jsonTabResult("{oops");
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain("not valid JSON");
	});

	test("a non-object top level is reported (an array is not a delta)", () => {
		for (const text of ["[1,2]", '"text"', "42", "null"]) {
			expect(jsonTabResult(text).ok).toBe(false);
		}
		expect(jsonTabResult("[]").errors[0]).toContain("an array");
	});

	test("an unknown key is REJECTED and NAMED, never dropped", () => {
		const result = jsonTabResult('{"fireModeBonus":{"burst":0}}');
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('unknown rule knob "fireModeBonus"');
		expect(result.delta).toEqual({});
	});

	test("a wrong-typed value is rejected and named", () => {
		const result = jsonTabResult(
			'{"ammo.autoConsume":"yes","combat.fireModeBonus.burst":"five"}',
		);
		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(2);
		expect(result.errors[0]).toContain('"ammo.autoConsume" expects a boolean');
		expect(result.errors[1]).toContain(
			'"combat.fireModeBonus.burst" expects a finite number',
		);
	});

	test("a null is rejected except on the nullable bands", () => {
		expect(jsonTabResult('{"test.autoFailRoll":null}').ok).toBe(true);
		expect(jsonTabResult('{"combat.fireModeBonus.burst":null}').ok).toBe(false);
	});

	test("a select value outside the registry's options is named", () => {
		const result = jsonTabResult('{"skills.untrainedSkill.model":"nope"}');
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain("half-characteristic | flat-penalty");
	});

	test("an unknown key survives as far as the diff panel, which also names it", () => {
		const rows = profileDiffRows({ legacy: { burst: 0 } });
		expect(rows).toHaveLength(1);
		expect(rows[0]!.unknown).toBe(true);
		expect(rows[0]!.labelKey).toBeNull();
	});
});

// --- the diff panel ------------------------------------------------------

describe("the diff panel: core vs effective", () => {
	test("an empty delta has no rows", () => {
		expect(profileDiffRows({})).toEqual([]);
		expect(breakingDiffRowCount(profileDiffRows({}))).toBe(0);
	});

	test("the effective side is the base profile with the delta merged over it", () => {
		const delta: ProfileDelta = {
			"combat.fireModeBonus.burst": 0,
			"tables.hitLocations": { "01-10": "head" },
		};
		const rows = profileDiffRows(delta);
		const burst = rows.find((r) => r.key === "combat.fireModeBonus.burst")!;
		expect(burst.coreValue).toBe(10);
		expect(burst.effectiveValue).toBe(0);
		expect(burst.overridden).toBe(true);
		const table = rows.find((r) => r.key === "tables.hitLocations")!;
		expect(table.coreDisplay.bands).toBe(6);
		expect(table.effectiveDisplay.bands).toBe(1);
		// ...and the merged profile itself agrees with those two rows.
		const effective = effectiveProfileFor(delta);
		expect(effective.fireModeBonus).toEqual({ burst: 0, full: 20 });
		expect(effective.hitLocations).toEqual({ "01-10": "head" });
	});

	test("ledger-assuming knobs that DIFFER are marked BREAKING", () => {
		const rows = profileDiffRows({
			"advancement.preSpentBaseline": 5000,
			// Stored at the core value: a ledger-assuming knob in the delta, but
			// no rule in force — so NOT breaking.
			"advancement.eliteAdvanceBaseCost": 500,
		});
		expect(breakingDiffRowCount(rows)).toBe(1);
		const baseline = rows[0]!;
		expect(baseline.breaking).toBe(true);
		expect(baseline.hazard).toBe("ledger-assuming");
		expect(baseline.hazardKey).toBe("RULES.HAZARD_LEDGER_ASSUMING");
		expect(rows[1]!.breaking).toBe(false);
	});

	test("an auto-recomputed knob that differs is never BREAKING", () => {
		const rows = profileDiffRows({ "ammo.autoConsume": true });
		expect(rows[0]!.overridden).toBe(true);
		expect(rows[0]!.breaking).toBe(false);
		expect(rows[0]!.hazardKey).toBe("RULES.HAZARD_AUTO_RECOMPUTED");
	});

	test("a creation-only knob is flagged with its own hazard key", () => {
		const rows = profileDiffRows({ "creation.pointBuyBudget": 120 });
		expect(rows[0]!.hazardKey).toBe("RULES.HAZARD_CREATION_ONLY");
		expect(rows[0]!.breaking).toBe(false);
	});

	test("a stored key equal to core shows as stored but not overridden", () => {
		const rows = profileDiffRows({ "ammo.autoConsume": false });
		expect(rows).toHaveLength(1);
		expect(rows[0]!.overridden).toBe(false);
		expect(rows[0]!.coreDisplay.yesNo).toBe(false);
		expect(rows[0]!.effectiveDisplay.yesNo).toBe(false);
	});
});

// --- the save path: profile management actions ---------------------------

describe("the save path: profile management actions", () => {
	test("create appends an empty profile and activates nothing", () => {
		const before = state([row("a")], "a");
		const after = applyProfileAction(before, {
			kind: "create",
			id: "profile-2",
			name: "Profile 2",
		});
		expect(after.rows).toEqual([row("a"), row("profile-2", "Profile 2")]);
		expect(after.activeId).toBe("a");
	});

	test("duplicate copies the delta under a new id and a new name", () => {
		const source = row("a", "A", { "ammo.autoConsume": true });
		const after = applyProfileAction(state([source], "a"), {
			kind: "duplicate",
			id: "a",
			newId: "profile-2",
			name: "A (copy)",
		});
		expect(after.rows).toHaveLength(2);
		const copy = after.rows[1]!;
		expect(copy.id).toBe("profile-2");
		expect(copy.name).toBe("A (copy)");
		expect(copy.delta).toEqual({ "ammo.autoConsume": true });
		// The copy is a separate row: editing it cannot reach the source.
		expect(after.rows[0]).toEqual(source);
		expect(after.activeId).toBe("a");
	});

	test("rename changes the name; an empty name is refused", () => {
		const before = state([row("a")]);
		expect(
			applyProfileAction(before, { kind: "rename", id: "a", name: " B " }),
		).toEqual(state([row("a", "B")]));
		expect(
			applyProfileAction(before, { kind: "rename", id: "a", name: " " }),
		).toBe(before);
		expect(
			applyProfileAction(before, { kind: "rename", id: "", name: "X" }),
		).toBe(before);
	});

	test("delete removes the row; deleting the ACTIVE row falls back to core", () => {
		const active = state([row("a"), row("b")], "b");
		expect(applyProfileAction(active, { kind: "delete", id: "b" })).toEqual(
			state([row("a")], ""),
		);
		expect(applyProfileAction(active, { kind: "delete", id: "a" })).toEqual(
			state([row("b")], "b"),
		);
	});

	test("Core cannot be renamed or deleted, and the state says so", () => {
		const before = state([row("a")], "");
		// Not a throw: the app turns the unchanged state into a visible refusal.
		expect(
			applyProfileAction(before, { kind: "rename", id: "", name: "X" }),
		).toBe(before);
		expect(applyProfileAction(before, { kind: "delete", id: "" })).toBe(before);
		expect(applyProfileAction(before, { kind: "delete", id: "nope" })).toBe(
			before,
		);
		expect(
			applyProfileAction(before, { kind: "rename", id: "nope", name: "X" }),
		).toBe(before);
	});

	test("saveDelta stores the validated delta; Core is refused", () => {
		const after = applyProfileAction(state([row("a")]), {
			kind: "saveDelta",
			id: "a",
			delta: { "ammo.autoConsume": true },
		});
		expect(after.rows[0]!.delta).toEqual({ "ammo.autoConsume": true });
		expect(
			applyProfileAction(after, { kind: "saveDelta", id: "", delta: {} }),
		).toBe(after);
		expect(
			applyProfileAction(after, { kind: "saveDelta", id: "nope", delta: {} }),
		).toBe(after);
	});

	test("activate names a row, or Core for anything else", () => {
		const before = state([row("a"), row("b")], "a");
		expect(
			applyProfileAction(before, { kind: "activate", id: "b" }).activeId,
		).toBe("b");
		// "" is the Core pseudo-entry: a legal activation, back to core rules.
		expect(
			applyProfileAction(before, { kind: "activate", id: "" }).activeId,
		).toBe("");
		expect(applyProfileAction(before, { kind: "activate", id: "nope" })).toBe(
			before,
		);
	});

	test("nextProfileId never collides with a stored id", () => {
		expect(nextProfileId([])).toBe("profile");
		expect(nextProfileId([row("profile")])).toBe("profile-2");
		expect(nextProfileId([row("profile"), row("profile-2")])).toBe("profile-3");
		expect(nextProfileId([row("profile-2")])).toBe("profile");
	});
});

// --- what actually reaches the settings ---------------------------------

describe("what the save path writes to the settings", () => {
	test("the whole array and the active id are written, together", () => {
		const harness = writeHarness();
		const value = ruleProfileWrite(
			state([row("a", "A", { "ammo.autoConsume": true })], "a"),
		);
		persistRuleProfiles(
			harness.surface,
			"rogue-trader",
			value,
			reportInto(harness),
		);
		expect(harness.writes.map((w) => w.key)).toEqual([
			...RULE_PROFILE_WRITE_KEYS,
		]);
		expect(harness.writes[0]!.value).toBe(
			'[{"id":"a","name":"A","delta":{"ammo.autoConsume":true}}]',
		);
		expect(harness.writes[1]!.value).toBe("a");
		// Nothing else is written: the app never writes a per-knob setting.
		expect(harness.writes).toHaveLength(2);
	});

	test("an EMPTY list is written as [] (valid JSON), and core as the active id", () => {
		const value = ruleProfileWrite(state([]));
		expect(value.ruleProfiles).toBe("[]");
		expect(value.activeProfileId).toBe("");
	});

	test("every row round-trips back through the tolerant decode", () => {
		const rows = [
			row("a", "A", { "ammo.autoConsume": true }),
			row("b", "B", {}),
		];
		const value = ruleProfileWrite(state(rows, "b"));
		expect(decodeStoredProfiles(value.ruleProfiles).rows).toEqual(rows);
		expect(
			stateFromSettings(value.ruleProfiles, value.activeProfileId),
		).toEqual(state(rows, "b"));
	});

	test("a rejected write warns and never escapes the save path", async () => {
		const rejections: unknown[] = [];
		const surface = {
			set: () => Promise.reject(new Error("world is read-only")),
		};
		expect(() =>
			persistRuleProfiles(
				surface,
				"rogue-trader",
				ruleProfileWrite(state([])),
				(error) => rejections.push(error),
			),
		).not.toThrow();
		// A SYNCHRONOUS throw is contained too (a settings surface that refuses
		// on the way in, as Foundry does for an unregistered key).
		let thrown = false;
		expect(() =>
			persistRuleProfiles(
				{
					set: () => {
						if (!thrown) {
							thrown = true;
							throw new Error("no settings database");
						}
					},
				},
				"rogue-trader",
				ruleProfileWrite(state([])),
				(error) => rejections.push(error),
			),
		).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();
		// Two keys rejected asynchronously plus the synchronous throw.
		expect(rejections).toHaveLength(3);
	});
});

describe("knob value comparison", () => {
	test("deep-equal covers records, arrays, null and undefined", () => {
		expect(
			knobValuesEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }),
		).toBe(true);
		expect(knobValuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(knobValuesEqual([1, 2], [2, 1])).toBe(false);
		expect(knobValuesEqual(null, null)).toBe(true);
		expect(knobValuesEqual(null, undefined)).toBe(false);
		expect(knobValuesEqual(0, false)).toBe(false);
	});

	test("readProfileValue walks the registry path", () => {
		expect(readProfileValue(rtCore, knobByKey("psychic.pushCap.other")!)).toBe(
			4,
		);
		expect(readProfileValue(rtCore, knobByKey("tables.hitLocations")!)).toBe(
			rtCore.hitLocations,
		);
	});

	test("selectedRow finds a stored row, and Core has none", () => {
		expect(selectedRow(state([row("a")]), "a")?.name).toBe("A");
		expect(selectedRow(state([row("a")]), "")).toBeNull();
		expect(selectedRow(state([row("a")]), "nope")).toBeNull();
	});
});

describe("rules pack export (bead wxut.5)", () => {
	test("the active scope exports the profile in force, and only that one", () => {
		const rows = [row("a"), row("b")];
		expect(packExportRows(state(rows, "b"), "active").map((r) => r.id)).toEqual([
			"b",
		]);
		expect(packExportRows(state(rows, "b"), "all").map((r) => r.id)).toEqual([
			"a",
			"b",
		]);
	});

	test("the active scope exports NOTHING while core rules are in force", () => {
		// There is no house rule to share; the panel says so rather than
		// shipping a pack whose profiles array is empty.
		expect(packExportRows(state([row("a")], ""), "active")).toEqual([]);
		// ...and the whole-world scope still has something to say.
		expect(packExportRows(state([row("a")], ""), "all")).toHaveLength(1);
	});

	test("the exported text is a pack the parser accepts, with the base filled", () => {
		const text = packExportText([row("a", "A", { "test.critOnDouble": false })], {
			profile: "rt-core",
			systemVersion: "1.2.3",
		});
		const parsed = parseRuleProfilePack(text);
		expect(parsed.valid).toBe(true);
		expect(parsed.profiles).toEqual([
			expect.objectContaining({
				id: "a",
				name: "A",
				delta: { "test.critOnDouble": false },
				base: { profile: "rt-core", systemVersion: "1.2.3" },
			}),
		]);
	});

	test("export -> import -> export is byte-identical for both scopes", () => {
		const rows = [
			row("a", "A", { "test.critOnDouble": false }),
			row("b", "B", {}),
		];
		for (const scope of ["active", "all"] as const) {
			const first = packExportText(packExportRows(state(rows, "a"), scope), {
				profile: "rt-core",
			});
			const parsed = parseRuleProfilePack(first);
			const second = packExportText(
				parsed.profiles.map((profile) => ({
					id: profile.id,
					name: profile.name,
					description: profile.description,
					base: profile.base,
					delta: profile.delta,
					snapshot: profile.snapshot,
				})),
				{ profile: "rt-core" },
			);
			expect(second).toBe(first);
		}
	});

	test("a GM's profile name becomes a filename fragment", () => {
		expect(packSlug("Silly burst")).toBe("silly-burst");
		expect(packSlug("Lethal (v2)")).toBe("lethal-v2");
		expect(packSlug("  ---  ")).toBe("profile");
	});
});

describe("rules pack import: merge by id (bead wxut.5)", () => {
	/** A parsed pack's profiles, as the parser hands them over. */
	function packProfiles(
		entries: readonly { id: string; name?: string; delta?: ProfileDelta }[],
	) {
		const parsed = parseRuleProfilePack({
			kind: "rogue-trader.rule-profiles",
			schemaVersion: 1,
			profiles: entries.map((e) => ({
				id: e.id,
				name: e.name ?? e.id.toUpperCase(),
				base: { profile: "rt-core" },
				delta: e.delta ?? {},
			})),
		});
		expect(parsed.valid).toBe(true);
		return parsed.profiles;
	}

	test("a new id is added to the list", () => {
		const before = state([row("a")], "a");
		const plan = packImportPlan(before, packProfiles([{ id: "b" }]));
		expect(plan.clashes).toEqual([]);
		expect(plan.added.map((r) => r.id)).toEqual(["b"]);
		expect(plan.actions).toEqual([
			{ kind: "create", id: "b", name: "B" },
			{ kind: "saveDelta", id: "b", delta: {} },
		]);
		const after = packImportState(before, plan);
		expect(after.rows.map((r) => r.id)).toEqual(["a", "b"]);
	});

	test("a same id CLASHES, and the plan says so before anything is written", () => {
		const before = state([row("a", "A", { "test.critOnDouble": false })], "a");
		const plan = packImportPlan(
			before,
			packProfiles([{ id: "a", name: "A-new", delta: { "ammo.autoConsume": true } }]),
		);
		// The app's confirmation is driven by exactly this list.
		expect(plan.clashes).toEqual([
			{ id: "a", existingName: "A", incomingName: "A-new" },
		]);
		expect(plan.added).toEqual([]);
		// An overwrite replaces the whole profile (name AND delta), not a merge.
		expect(plan.actions).toEqual([
			{ kind: "rename", id: "a", name: "A-new" },
			{ kind: "saveDelta", id: "a", delta: { "ammo.autoConsume": true } },
		]);
		const after = packImportState(before, plan);
		expect(after.rows).toEqual([
			{ id: "a", name: "A-new", delta: { "ammo.autoConsume": true } },
		]);
	});

	test("one imported profile may become the active one on request", () => {
		const before = state([row("a")], "a");
		const plan = packImportPlan(before, packProfiles([{ id: "b" }]), true);
		expect(plan.canActivate).toBe(true);
		expect(plan.activateId).toBe("b");
		expect(packImportState(before, plan).activeId).toBe("b");
	});

	test("several imported profiles leave the active one to the GM", () => {
		const before = state([row("a")], "a");
		const plan = packImportPlan(before, packProfiles([{ id: "b" }, { id: "c" }]), true);
		// "Activate it" would be a guess: the plan refuses rather than picking.
		expect(plan.canActivate).toBe(false);
		expect(plan.activateId).toBeNull();
		expect(plan.actions.some((action) => action.kind === "activate")).toBe(false);
		expect(packImportState(before, plan).activeId).toBe("a");
	});

	test("an import mixes new rows and overwrites in one pass", () => {
		const before = state([row("a", "A", { "test.critOnDouble": false })], "a");
		const plan = packImportPlan(
			before,
			packProfiles([
				{ id: "a", name: "A", delta: {} },
				{ id: "b", name: "B", delta: { "ammo.autoConsume": true } },
			]),
		);
		expect(plan.added.map((r) => r.id)).toEqual(["b"]);
		expect(plan.clashes.map((c) => c.id)).toEqual(["a"]);
		const after = packImportState(before, plan);
		expect(after.rows).toEqual([
			{ id: "a", name: "A", delta: {} },
			{ id: "b", name: "B", delta: { "ammo.autoConsume": true } },
		]);
	});

	test("an import that replaces the ACTIVE profile keeps it active", () => {
		const before = state([row("a", "A", { "test.critOnDouble": false })], "a");
		const plan = packImportPlan(
			before,
			packProfiles([{ id: "a", delta: { "ammo.autoConsume": true } }]),
		);
		expect(packImportState(before, plan).activeId).toBe("a");
	});
});

// ---------------------------------------------------------------------------
// Whose registry? (bead w9sa.2)
// ---------------------------------------------------------------------------

/**
 * A FAKE sibling system, in the shape bead w9sa.3 will author DH2's for real.
 *
 * Its knobs share nothing with Rogue Trader's — the Standard Attack is its own
 * knob (DH2e, p226, where RT has a Semi-Auto Burst BONUS), untrained is a flat
 * penalty (DH2e, p80) and there is no push cap at all — so a view model that
 * still resolves RT's registry cannot pass by accident. The paths point at
 * fields the RT profile really has, because the fake proves the REGISTRY is an
 * argument; bead w9sa.3 owns the sibling PROFILE type and its citations.
 */
const SIBLING_KNOBS: readonly RuleKnob[] = [
	{
		key: "combat.standardMode",
		path: ["fireModeBonus", "burst"],
		labelKey: "RULES.COMBAT_STANDARD_MODE",
		hintKey: "RULES.COMBAT_STANDARD_MODE.HINT",
		group: "combat",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 10,
	},
	{
		key: "skills.untrainedPenalty",
		path: ["untrainedSkill", "penalty"],
		labelKey: "RULES.SKILLS_UNTRAINED_PENALTY",
		hintKey: "RULES.SKILLS_UNTRAINED_PENALTY.HINT",
		group: "skills",
		control: "number",
		hazard: "auto-recomputed",
		coreValue: 20,
	},
	{
		key: "damage.righteousFury",
		path: ["righteousFury", "enabled"],
		labelKey: "RULES.DAMAGE_RIGHTEOUS_FURY",
		hintKey: "RULES.DAMAGE_RIGHTEOUS_FURY.HINT",
		group: "damage",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: rtCore.righteousFury.enabled,
	},
];
const SIBLING_REGISTRY: RuleKnobRegistry = {
	systemId: "dark-heresy-2e",
	knobs: SIBLING_KNOBS,
};
/** A knob key only the SIBLING registry knows. */
const SIBLING_KEY = "combat.standardMode";
/** A knob key only RT's registry knows. */
const RT_ONLY_KEY = "psychic.pushCap.sanctioned";

afterEach(() => {
	resetRuleKnobRegistryForTests();
});

describe("the registry is an argument end to end", () => {
	test("the DEFAULT is Rogue Trader's, byte for byte", () => {
		expect(ruleKnobRegistry().systemId).toBe("rogue-trader");
		expect(knobFields({}, true).map((field) => field.knob.key)).toEqual([
			...RULE_KNOB_KEYS,
		]);
	});

	test("a foreign registry yields ITS knobs in the form", () => {
		const groups = knobGroupViews(
			{ [SIBLING_KEY]: -10 },
			true,
			SIBLING_REGISTRY.knobs,
		);
		expect(groups.map((group) => group.group)).toEqual([
			"combat",
			"skills",
			"damage",
		]);
		expect(knobFieldKeys(groups.flatMap((group) => group.fields))).toEqual([
			SIBLING_KEY,
			"skills.untrainedPenalty",
			"damage.righteousFury",
		]);
		// RT's fire-mode and push-cap knobs are simply NOT THERE.
		expect(knobFieldKeys(groups.flatMap((g) => g.fields))).not.toContain(
			"combat.fireModeBonus.burst",
		);
		expect(knobFieldKeys(groups.flatMap((g) => g.fields))).not.toContain(
			RT_ONLY_KEY,
		);
		// The pending value rides on the sibling's own knob.
		const standard = groups[0]!.fields[0]!;
		expect(standard.inputValue).toBe("-10");
		expect(standard.overridden).toBe(true);
		expect(standard.labelKey).toBe("RULES.COMBAT_STANDARD_MODE");
	});

	test("...and through the ACTIVE-REGISTRY default, no argument given", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		expect(knobFields({}, true).map((field) => field.knob.key)).toEqual([
			SIBLING_KEY,
			"skills.untrainedPenalty",
			"damage.righteousFury",
		]);
	});

	test("a foreign draft stores only the knobs the registry describes", () => {
		// Unknown to the registry means UNKNOWN: kept as given so the validator
		// can name it, never quietly dropped.
		const delta = deltaFromDraft(
			{ [SIBLING_KEY]: -10, "test.critOnDouble": false },
			SIBLING_REGISTRY.knobs,
		);
		expect(delta).toEqual({
			[SIBLING_KEY]: -10,
			"test.critOnDouble": false,
		});
		// Set to the registry's OWN core value, it is an absent key again.
		expect(deltaFromDraft({ [SIBLING_KEY]: 10 }, SIBLING_REGISTRY.knobs)).toEqual(
			{},
		);
	});

	test("the diff is against the registry in force", () => {
		const rows = profileDiffRows(
			{ [SIBLING_KEY]: -10, [RT_ONLY_KEY]: 5 },
			SIBLING_REGISTRY.knobs,
		);
		const standard = rows.find((row) => row.key === SIBLING_KEY)!;
		expect(standard.unknown).toBe(false);
		expect(standard.labelKey).toBe("RULES.COMBAT_STANDARD_MODE");
		expect(standard.coreValue).toBe(10);
		expect(standard.effectiveValue).toBe(-10);
		expect(standard.overridden).toBe(true);
		// The RT knob is a row the registry does not describe, and the diff
		// says so rather than inventing a value for it.
		const rtOnly = rows.find((row) => row.key === RT_ONLY_KEY)!;
		expect(rtOnly.unknown).toBe(true);
		expect(rtOnly.overridden).toBe(true);
		expect(rtOnly.breaking).toBe(false);
		expect(breakingDiffRowCount(rows)).toBe(0);
	});

	test("the JSON tab validates against the registry in force", () => {
		const ok = jsonTabResult(
			`{"${SIBLING_KEY}": -10}`,
			SIBLING_REGISTRY.knobs,
		);
		expect(ok.ok).toBe(true);
		expect(ok.delta).toEqual({ [SIBLING_KEY]: -10 });
		const bad = jsonTabResult(
			`{"${RT_ONLY_KEY}": 5}`,
			SIBLING_REGISTRY.knobs,
		);
		expect(bad.ok).toBe(false);
		expect(bad.delta).toEqual({});
		expect(bad.errors[0]).toContain(RT_ONLY_KEY);
	});

	test("the table knob is found from the registry, not from RT's key", () => {
		expect(tableKnobKey(RULE_KNOBS)).toBe("tables.hitLocations");
		expect(tableKnobKey(SIBLING_REGISTRY.knobs)).toBeNull();
		expect(tableKnobKey()).toBe("tables.hitLocations");
	});

	test("an export is stamped with the kind of the registry exporting it", () => {
		registerRuleKnobRegistry(SIBLING_REGISTRY);
		expect(packExportText([{ id: "s", name: "S", delta: {} }], {
			profile: "dh2-core",
		})).toContain('"kind": "dark-heresy-2e.rule-profiles"');
	});

	test("RT is untouched when nothing is registered", () => {
		expect(packExportText([{ id: "a", name: "A", delta: {} }], {
			profile: "rt-core",
		})).toContain('"kind": "rogue-trader.rule-profiles"');
		expect(effectiveProfileFor({ "combat.fireModeBonus.burst": 0 }).fireModeBonus)
			.toEqual({ burst: 0, full: 20 });
	});
});
