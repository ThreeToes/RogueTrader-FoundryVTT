// Pure unit tests for the per-row warrant choice views (bead twtq): the
// read-only choice tabs of the dynasty sheet resolve their row's PICKED
// entry from the runtime warrant pool. See warrant-views.ts — fixtures
// cover picked / unpicked / stale-pick / empty-pool rows, none of which may
// render as a broken empty tab.
import { describe, expect, test } from "bun:test";
import { warrantChoiceViews, type WarrantChoiceView } from "./warrant-views";
import type { WarrantEntry } from "../../rules/warrant";

/** A pool covering two paths of options, in row/column order. */
const entries: WarrantEntry[] = [
	{ key: "a1", row: "warrant-age", col: 1, name: "Age of Sin", description: "<p>Sin grows the dynasty.</p>", mechanics: { shipPoints: 9, profitFactor: 5 } },
	{ key: "a2", row: "warrant-age", col: 2, name: "Age of Redemption", description: "<p>Redemption.</p>", mechanics: { shipPoints: 10, notes: ["Gain an Archeotech component"] } },
	{ key: "b3", row: "fortune-fate", col: 3, name: "Rising Star", description: "", mechanics: { profitFactor: 2 } },
	{ key: "c3", row: "acquisition", col: 3, name: "Seed Currency", description: "", mechanics: { profitFactor: 1 } },
	{ key: "d3", row: "sanction", col: 3, name: "Sanctioned", description: "", mechanics: {} },
	{ key: "e3", row: "contacts", col: 3, name: "Cartel", description: "", mechanics: {} },
	{ key: "f3", row: "renown", col: 3, name: "Renowned", description: "", mechanics: { shipPoints: 3 } },
];

const FULL: Record<string, string> = {
	"warrant-age": "a2",
	"fortune-fate": "b3",
	acquisition: "c3",
	sanction: "d3",
	contacts: "e3",
	renown: "f3",
};

describe("warrantChoiceViews (bead twtq)", () => {
	test("a full path resolves every row's picked entry", () => {
		const views = warrantChoiceViews(FULL, entries);
		expect(views.map((view) => view.row)).toEqual([
			"warrant-age",
			"fortune-fate",
			"acquisition",
			"sanction",
			"contacts",
			"renown",
		]);
		const age = views[0];
		expect(age.picked).toBe(true);
		expect(age.resolved).toBe(true);
		expect(age.name).toBe("Age of Redemption");
		expect(age.description).toBe("<p>Redemption.</p>");
		expect(age.shipPoints).toBe(10);
		expect(age.profitFactor).toBe(null); // no PF contribution on that entry
		expect(age.notes).toEqual(["Gain an Archeotech component"]);
	});

	test("contribution fields carry the picked entry's SP/PF verbatim", () => {
		const views = warrantChoiceViews(FULL, entries);
		const star = views[1]!;
		expect(star.name).toBe("Rising Star");
		expect(star.shipPoints).toBe(null);
		expect(star.profitFactor).toBe(2);
		const sanction = views[3]!;
		expect(sanction.shipPoints).toBe(null);
		expect(sanction.profitFactor).toBe(null);
	});

	test("unpicked rows stay unresolved but keep their tab wiring", () => {
		const partial: Record<string, string> = { "warrant-age": "a2", "fortune-fate": "b3" };
		const views = warrantChoiceViews(partial, entries);
		const later = views.filter((view) => !partial[view.row]);
		expect(later.length).toBe(4);
		for (const view of later) {
			expect(view.picked).toBe(false);
			expect(view.resolved).toBe(false);
			expect(view.pickKey).toBe("");
			expect(view.name).toBe("");
			expect(view.description).toBe("");
			expect(view.shipPoints).toBe(null);
			expect(view.profitFactor).toBe(null);
			expect(view.notes).toEqual([]);
		}
	});

	test("a stale pick (key no longer in the pool) shows picked-but-unresolved", () => {
		const stale: Record<string, string> = { ...FULL, "warrant-age": "a9" };
		const views = warrantChoiceViews(stale, entries);
		const age = views[0];
		expect(age?.picked).toBe(true);
		expect(age?.resolved).toBe(false);
		expect(age?.pickKey).toBe("a9");
		// A pick the pool cannot resolve is not an entry: no name/desc/stats.
		expect(age?.name).toBe("");
		expect(age?.description).toBe("");
		expect(age?.shipPoints).toBe(null);
		// Downstream rows are unaffected by the stale KEY (pruning is a write-
		// time concern, pruneWarrantPicks — the view reports what it sees).
		expect(views[1]?.resolved).toBe(true);
	});

	test("an empty pool (pack absent) resolves nothing, never throws", () => {
		const views = warrantChoiceViews(FULL, []);
		expect(views.map((view) => view.resolved)).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
		]);
		// The stored keys are still reported (the read-only chips line falls
		// back to them when no name resolves).
		expect(views.map((view) => view.pickKey)).toEqual([
			"a2",
			"b3",
			"c3",
			"d3",
			"e3",
			"f3",
		]);
	});

	test("the view keeps the row's i18n label key per row", () => {
		const views = warrantChoiceViews({}, entries);
		const labels: Record<string, string> = Object.fromEntries(
			views.map((view: WarrantChoiceView) => [view.row, view.labelKey]),
		);
		expect(labels["warrant-age"]).toBe("WARRANT.ROW_WARRANT_AGE");
		expect(labels.renown).toBe("WARRANT.ROW_RENOWN");
	});

	test("the pool input is not mutated (pure helper)", () => {
		const before = JSON.stringify(entries);
		warrantChoiceViews(FULL, entries);
		expect(JSON.stringify(entries)).toBe(before);
	});

	test("the record's notes block never leaves the picked entry", () => {
		// Notes belong to the picked entry only: an unpicked row never shows
		// another row's notes (bead twtq acceptance).
		const views = warrantChoiceViews(FULL, entries);
		for (const view of views) {
			if (view.row === "warrant-age") continue;
			expect(view.notes).toEqual([]);
		}
	});
});