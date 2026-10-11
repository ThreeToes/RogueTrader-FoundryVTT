/**
 * The module group in the rules app (epic wxut, child B6 — sharing tier T2).
 *
 * A module registers a profile at its own init, and the app lists it under its
 * own heading: READ-ONLY, but selectable and activatable like any other
 * profile. These tests pin both halves of that — the pure view model that
 * derives the group, and the app shell that renders it and refuses to edit it.
 *
 * The rule the group exists to keep: a module's profile is DATA THE MODULE
 * SHIPPED. Nothing the app writes may copy its delta into the world's
 * `ruleProfiles`; the only write a module profile accepts is the
 * `activeProfileId` that puts it in force. So:
 *   1. the group is SEPARATE from the stored list — not one of its rows;
 *   2. activation is the ONE action that accepts a module id;
 *   3. every editing action (rename, duplicate, delete, save) refuses it, by
 *      name rather than by a disabled button alone.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { ProfileDelta } from "../../ffg/domain/rule-knobs";
import {
	activeEntry,
	applyProfileAction,
	CORE_PROFILE_ID,
	moduleProfileEntries,
	nextProfileId,
	profileList,
	ruleProfileWrite,
	selectedProfile,
	selectedRow,
	stateFromSettings,
	type ModuleProfileRow,
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

/** A module-registered profile, as the registry hands it over. */
function moduleProfile(
	id: string,
	name = id.toUpperCase(),
	delta: ProfileDelta = {},
): ModuleProfileRow {
	return { id, name, delta };
}

function state(
	rows: readonly RuleProfileRow[],
	activeId = "",
	moduleProfiles: readonly ModuleProfileRow[] = [],
): RuleProfileState {
	return { rows, activeId, ...(moduleProfiles.length > 0 ? { moduleProfiles } : {}) };
}

const LETHAL: ModuleProfileRow = moduleProfile("lethal-crits", "Lethal crits", {
	"test.critOnDouble": true,
});

// --- the group is its own list, read-only --------------------------------

describe("the module group (read-only, activation only)", () => {
	test("a module profile is listed with its own name and NO edit affordance", () => {
		const entries = moduleProfileEntries(state([], "", [LETHAL]));
		expect(entries).toHaveLength(1);
		const entry = entries[0]!;
		expect(entry.id).toBe("lethal-crits");
		expect(entry.name).toBe("Lethal crits");
		// It is not the book and not the world's own row: its provenance is the
		// module, which is why the group is rendered apart.
		expect(entry.isCore).toBe(false);
		expect(entry.source).toBe("module");
		// Read-only: no edit, no duplicate, no rename, no delete.
		expect(entry.canEdit).toBe(false);
		expect(entry.canDelete).toBe(false);
		// No i18n key either — a module names its own profile.
		expect(entry.nameKey).toBeNull();
	});

	test("the module group is NOT part of the world's profile list", () => {
		// Two separate `each` loops in the template, and the reason is this:
		// `state.rows` is what the app writes back, so a module row in it could
		// never be refused.
		const s = state([row("a")], "", [LETHAL]);
		expect(profileList(s).map((entry) => entry.id)).toEqual(["", "a"]);
		expect(profileList(s).every((entry) => entry.source !== "module")).toBe(true);
		expect(moduleProfileEntries(s)).toHaveLength(1);
	});

	test("a module profile can be the ACTIVE entry, and the book knows it", () => {
		const s = state([row("a")], "lethal-crits", [LETHAL]);
		const active = activeEntry(s);
		expect(active?.id).toBe("lethal-crits");
		expect(active?.source).toBe("module");
		// The world's own row is not in force, so nothing of it shows as active.
		expect(profileList(s).find((entry) => entry.isActive)).toBeUndefined();
		expect(moduleProfileEntries(s)[0]?.isActive).toBe(true);
	});

	test("a module id a world row also owns is SHADOWED, never double-active", () => {
		// The world's row resolves first (stateFromSettings), so the rules run
		// the GM's version; the module entry still lists, but without the flag.
		const s = state([row("lethal-crits")], "lethal-crits", [LETHAL]);
		expect(moduleProfileEntries(s)[0]?.isActive).toBe(false);
		expect(activeEntry(s)?.source).toBe("world");
	});

	test("selecting a module profile shows its delta, read-only", () => {
		const selected = selectedProfile(state([], "lethal-crits", [LETHAL]), "lethal-crits");
		expect(selected.known).toBe(true);
		expect(selected.source).toBe("module");
		expect(selected.editable).toBe(false);
		// The panels still read it: a GM must be able to see what a module changed.
		expect(selected.delta).toEqual({ "test.critOnDouble": true });
		expect(selected.name).toBe("Lethal crits");
	});

	test("a core selection reads as core, an unknown id reads as nothing known", () => {
		const s = state([row("a")], "", [LETHAL]);
		expect(selectedProfile(s, CORE_PROFILE_ID).source).toBe("core");
		expect(selectedProfile(s, CORE_PROFILE_ID).editable).toBe(false);
		expect(selectedProfile(s, "deleted-row").known).toBe(false);
		expect(selectedProfile(s, "deleted-row").source).toBe("core");
	});

	test("a WORLD row is still editable, module or not", () => {
		const s = state([row("a")], "a", [LETHAL]);
		const selected = selectedProfile(s, "a");
		expect(selected.source).toBe("world");
		expect(selected.editable).toBe(true);
		expect(selectedRow(s, "a")).not.toBeNull();
	});
});

// --- activation is the one write a module profile accepts -----------------

describe("activating a module profile (bead wxut.6)", () => {
	test("activation is accepted for a module id", () => {
		const s = state([row("a")], "a", [LETHAL]);
		const next = applyProfileAction(s, { kind: "activate", id: "lethal-crits" });
		expect(next.activeId).toBe("lethal-crits");
		// The world's rows are untouched: the state is otherwise the same state.
		expect(next.rows).toBe(s.rows);
	});

	test("activation BACK to core is accepted, and so is a world row", () => {
		const s = state([row("a")], "lethal-crits", [LETHAL]);
		expect(applyProfileAction(s, { kind: "activate", id: "" }).activeId).toBe("");
		expect(
			applyProfileAction(s, { kind: "activate", id: "a" }).activeId,
		).toBe("a");
	});

	test("an id that is neither a row nor a module is still refused", () => {
		const s = state([row("a")], "a", [LETHAL]);
		expect(
			applyProfileAction(s, { kind: "activate", id: "nope" }),
		).toBe(s);
	});

	test("rename, duplicate, delete and save all refuse a module id", () => {
		const s = state([row("a")], "lethal-crits", [LETHAL]);
		// Each one leaves the state object IDENTICAL (the app tells a refusal
		// from a success by reference), so a module's rules cannot be rewritten.
		expect(
			applyProfileAction(s, { kind: "rename", id: "lethal-crits", name: "Mine" }),
		).toBe(s);
		expect(
			applyProfileAction(s, {
				kind: "duplicate",
				id: "lethal-crits",
				newId: "mine",
				name: "Mine",
			}),
		).toBe(s);
		expect(applyProfileAction(s, { kind: "delete", id: "lethal-crits" })).toBe(s);
		expect(
			applyProfileAction(s, {
				kind: "saveDelta",
				id: "lethal-crits",
				delta: { "test.critOnDouble": false },
			}),
		).toBe(s);
	});

	test("the settings write carries ONLY the active id — never the module delta", () => {
		const s = state(
			[row("a", "A", { "ammo.autoConsume": true })],
			"lethal-crits",
			[LETHAL],
		);
		const write = ruleProfileWrite(s);
		// The stored list is exactly what the world owns: one row, the GM's own.
		expect(JSON.parse(write.ruleProfiles)).toEqual([
			{ id: "a", name: "A", delta: { "ammo.autoConsume": true } },
		]);
		// ...and the module's delta is nowhere in it.
		expect(write.ruleProfiles).not.toContain("lethal-crits");
		expect(write.ruleProfiles).not.toContain("critOnDouble");
		expect(write.activeProfileId).toBe("lethal-crits");
	});

	test("the written pair round-trips: the module profile is still in force", () => {
		const s = state(
			[row("a", "A", { "ammo.autoConsume": true })],
			"lethal-crits",
			[LETHAL],
		);
		const write = ruleProfileWrite(s);
		const back = stateFromSettings(
			write.ruleProfiles,
			write.activeProfileId,
			[LETHAL],
		);
		expect(back.activeId).toBe("lethal-crits");
		expect(back.rows.map((r) => r.id)).toEqual(["a"]);
	});

	test("a new world profile never takes a module profile's id", () => {
		const rows = [row("profile")];
		expect(nextProfileId(rows, [moduleProfile("profile-2")])).toBe("profile-3");
		// Without the module list the old behaviour holds exactly.
		expect(nextProfileId(rows)).toBe("profile-2");
	});

	test("an active id naming nothing is still core rules", () => {
		// The module list only makes a module id survivable; a stale id stays core.
		expect(stateFromSettings("[]", "lethal-crits").activeId).toBe("");
		expect(stateFromSettings("[]", "lethal-crits", [LETHAL]).activeId).toBe(
			"lethal-crits",
		);
	});
});

// --- the app shell: the group renders, the edits are refused --------------

describe("the module group in the app shell", () => {
	const template = readFileSync("template/dialog/rules-app.hbs", "utf8");
	const appSource = readFileSync(
		"src/roguetrader/presentation/rules-app.ts",
		"utf8",
	);

	test("the module group renders under its own heading, only when there is one", () => {
		// The heading is localised, the rows are the view model's module entries,
		// and the whole block is behind a truthiness check on the list — a world
		// with no modules sees the sidebar exactly as before.
		expect(template).toContain("{{#if moduleProfiles.length}}");
		expect(template).toContain('{{localize "RULES.MODULE_GROUP"}}');
		expect(template).toContain("{{#each moduleProfiles as |p|}}");
		expect(template).toContain('data-action="selectProfile"');
		// Selecting a module row is the SAME action as selecting a world row, so
		// there is no second code path to drift.
		const block = template.slice(
			template.indexOf("{{#if moduleProfiles.length}}"),
			template.indexOf('{{localize "RULES.MODULE_HINT"}}'),
		);
		expect(block).not.toContain('data-action="deleteProfile"');
		expect(block).not.toContain('data-action="renameProfile"');
		expect(block).not.toContain('data-action="duplicateProfile"');
	});

	test("the module rows are read-only in the header, and say why", () => {
		// `editable` is false for a module row, which is what disables rename,
		// duplicate, delete and save. The read-only sentence names the MODULE
		// rather than the Core Rulebook, so a GM is not told the wrong thing.
		expect(appSource).toContain("RULES.MODULE_READONLY");
		expect(appSource).toContain("RULES.CORE_READONLY");
		expect(appSource).toContain("context.readOnlyKey");
		expect(template).toContain("{{localize readOnlyKey}}");
	});

	test("the app reads the registry through the extension namespace", () => {
		// The same namespace a module registers through (bootstrap/config.ts
		// attaches both halves), so the app lists what the rules run on.
		expect(appSource).toContain("ROGUE_TRADER");
		expect(appSource).toContain("ruleProfiles?");
		expect(appSource).toContain("readModuleProfiles()");
		// A missing or hostile namespace is NO MODULE PROFILES, never a throw.
		expect(appSource).toContain("could not read module profiles");
	});

	test("the module group RENDERS (an empty context never reaches it)", async () => {
		// `bun run verify:templates` renders every template against a PERMISSIVE
		// EMPTY context, so `{{#if moduleProfiles.length}}` is skipped there: the
		// group's body is exactly the kind bead 7tjo pinned on the advancement
		// dialog — it only executes with data. So it is compiled HERE against the
		// shape _prepareContext builds.
		const start = template.indexOf('<aside class="rules-sidebar">');
		const end = template.indexOf("</aside>", start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const Handlebars = (await import("handlebars")).default;
		Handlebars.registerHelper("localize", (key: string) => String(key));
		Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
		const compiled = Handlebars.compile(
			`{{#if true}}${template.slice(start, end)}{{/if}}`,
		);

		// One world profile, one module profile, the module in force and selected.
		const html = compiled({
			profiles: [
				{ id: "", name: "", nameKey: "RULES.PROFILE_CORE", isActive: false },
				{ id: "mine", name: "Mine", nameKey: null, isActive: false },
			],
			moduleProfiles: [
				{ id: "lethal-crits", name: "Lethal crits", isActive: true },
			],
			selectedId: "lethal-crits",
			skippedProfiles: [],
		});
		// The heading, the module row and its ACTIVE flag all reach the DOM.
		expect(html).toContain(
			'class="rules-group-label rules-module-label">RULES.MODULE_GROUP',
		);
		expect(html).toContain(
			'data-action="selectProfile" data-profile-id="lethal-crits"',
		);
		expect(html).toContain("Lethal crits");
		expect(html).toContain(
			'class="rules-profile module selected active"',
		);
		// The group offers NO edit affordance of its own.
		expect(html).not.toContain('data-action="deleteProfile"');
		// ...and the module hint says what activation would do.
		expect(html).toContain("RULES.MODULE_HINT");

		// No modules registered: the sidebar is the sidebar the world always had.
		const worldOnly = compiled({
			profiles: [
				{ id: "", name: "", nameKey: "RULES.PROFILE_CORE", isActive: true },
			],
			moduleProfiles: [],
			selectedId: "",
			skippedProfiles: [],
		});
		expect(worldOnly).not.toContain("rules-module-label");
		expect(worldOnly).not.toContain("RULES.MODULE_HINT");
		expect(worldOnly).toContain("RULES.CORE_HINT");
	});

	test("every i18n key the module group uses exists in all four lang files", () => {
		for (const lang of ["en", "es", "fr", "pl"]) {
			const dict = JSON.parse(
				readFileSync(`lang/${lang}.json`, "utf8"),
			) as Record<string, string>;
			for (const key of [
				"RULES.MODULE_GROUP",
				"RULES.MODULE_HINT",
				"RULES.MODULE_READONLY",
			]) {
				expect(dict[key], `${lang}.json is missing ${key}`).toBeTruthy();
			}
		}
	});
});
