// Regression tests for the Clear Warrant Path button (bead uuef).
//
// ROOT CAUSE: #onClearWarrant updated picks with a bare empty replacement
// object ("system.warrant.picks": {}) — Foundry v14's TypedObjectField#
// _updateDiff only walks the keys PRESENT in the update, so an empty
// replacement (or a pruned record whose only change is a removed key) yields
// an empty diff and is silently dropped; the stored picks survived and the
// sheet looked untouched. The fix expresses removals with the v14-native
// foundry.data.operators.ForcedDeletion per removed key (warrantPicksDelta).
//
// The handler itself dispatches fine (ApplicationV2#onClickAction calls
// DEFAULT_OPTIONS.actions.<name> with the app as `this` — verified against
// core v14.366 client/applications/api/application.mjs), so the tests drive
// the registered action exactly the way core does: handler.call(appStub,
// event, target) against a record-keeping document stub (creators.test.ts
// stub-globals precedent).

import { afterAll, describe, expect, test } from "bun:test";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = {
	i18n: { localize: (key: string) => key, format: (key: string) => key },
	system: { id: "rogue-trader" },
};
globals.ui = { notifications: { warn: () => undefined, info: () => undefined } };
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };

/** Recognizable stand-in for the v14 forced-deletion operator. */
class ForcedDeletionStub {
	readonly deletionOperator = "ForcedDeletion";
}
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				render(): Promise<unknown> {
					return Promise.resolve();
				}
			},
			TextEditor: { enrichHTML: async (html: string) => html },
			DialogV2: { wait: async () => null, input: async () => null },
		},
		sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
		ux: { TextEditor: { enrichHTML: async (html: string) => html } },
	},
	abstract: { TypeDataModel: class {} },
	documents: { Item: class {}, Actor: class {} },
	data: { operators: { ForcedDeletion: ForcedDeletionStub } },
};

const { DynastySheet, warrantPicksDelta } = await import("./dynasty-sheet");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const handler = () => {
	const options = (DynastySheet as unknown as {
		DEFAULT_OPTIONS: {
			actions: Record<string, (this: unknown, event: unknown, target: unknown) => Promise<void>>;
		};
	}).DEFAULT_OPTIONS.actions;
	expect(options.clearWarrant).toBeTypeOf("function");
	return options.clearWarrant;
};

const isDeletion = (value: unknown): boolean =>
	value instanceof ForcedDeletionStub;

describe("warrantPicksDelta (bead uuef root cause)", () => {
	test("clearing to {} emits a deletion operator per stored row, never an empty replacement", () => {
		const delta = warrantPicksDelta(
			{
				"warrant-age": "a2",
				"fortune-fate": "b3",
				renown: "f3",
			},
			{},
		);
		expect(Object.keys(delta).sort()).toEqual([
			"system.warrant.picks.fortune-fate",
			"system.warrant.picks.renown",
			"system.warrant.picks.warrant-age",
		]);
		for (const value of Object.values(delta)) {
			expect(isDeletion(value)).toBe(true);
		}
		// The silently-dropping form must not be used again.
		expect(delta["system.warrant.picks"]).toBeUndefined();
	});

	test("a fully-picked untouched record yields an empty delta (no spurious writes)", () => {
		const picks = { "warrant-age": "a1", renown: "f3" };
		expect(warrantPicksDelta(picks, { ...picks })).toEqual({});
	});

	test("changing one row and dropping another emits one set + one deletion", () => {
		const delta = warrantPicksDelta(
			{ "warrant-age": "a1", "fortune-fate": "b3" },
			{ "warrant-age": "a2" },
		);
		expect(delta["system.warrant.picks.warrant-age"]).toBe("a2");
		expect(isDeletion(delta["system.warrant.picks.fortune-fate"])).toBe(true);
		expect(Object.keys(delta)).toHaveLength(2);
	});
});

describe("#onClearWarrant (registered data-action handler)", () => {
	test("clears every stored pick with deletion operators and zeroes the path totals", async () => {
		const picks = {
			"warrant-age": "a1",
			"fortune-fate": "b3",
			acquisition: "c3",
		};
		const updates: Array<Record<string, unknown>> = [];
		const renders: Array<{ force?: boolean }> = [];
		const document = {
			system: {
				warrant: { picks, shipPoints: 19, profitFactor: 8 },
			},
			update: async (data: Record<string, unknown>) => {
				updates.push(data);
				Object.assign(picks, {}); // the applied picks record
				return data;
			},
		};
		const app = {
			document,
			render: (options: { force?: boolean }) => {
				renders.push(options);
			},
		};
		await handler().call(app, {}, { dataset: { action: "clearWarrant" } });
		expect(updates).toHaveLength(1);
		const update = updates[0]!;
		const deletions = Object.entries(update).filter(([key]) =>
			key.startsWith("system.warrant.picks."),
		);
		expect(deletions).toHaveLength(3);
		for (const [, value] of deletions) expect(isDeletion(value)).toBe(true);
		expect(update["system.warrant.picks"]).toBeUndefined();
		expect(update["system.warrant.shipPoints"]).toBe(0);
		expect(update["system.warrant.profitFactor"]).toBe(0);
		// The applied PF/SP totals are left alone (the GM may keep them) and
		// the sheet re-renders.
		expect(update["system.profitFactor"]).toBeUndefined();
		expect(update["system.shipPoints.total"]).toBeUndefined();
		expect(renders).toEqual([{ force: true }]);
	});

	test("an empty picks record still zeroes the path totals without spurious deletions", async () => {
		const updates: Array<Record<string, unknown>> = [];
		const document = {
			system: { warrant: { picks: {}, shipPoints: 0, profitFactor: 0 } },
			update: async (data: Record<string, unknown>) => {
				updates.push(data);
				return data;
			},
		};
		const app = { document, render: () => undefined };
		await handler().call(app, {}, { dataset: { action: "clearWarrant" } });
		expect(updates[0]).toEqual({
			"system.warrant.shipPoints": 0,
			"system.warrant.profitFactor": 0,
		});
	});
});