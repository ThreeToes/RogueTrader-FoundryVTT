/**
 * Ship-boarding row vocabulary (epic necp bead w98s, Core Rulebook p215):
 * the boarding machinery rows enter through the SHARED ship-action kind
 * (owner decision 2), dispatched by the row key the item's canonical name
 * normalises to. This suite pins the dispatch vocabulary itself; the maths
 * (hull-class die, boardingCommandBonus, routRoll) is pinned in
 * rules-engine/ship-turn-state.test.ts; the handler gates/outcomes run in
 * roll-pipeline.test.ts's fake-ports pattern.
 */

// The rows load through ship-action.ts (which touches test-dialog at module
// load), so the Foundry globals need the same minimal stubs first.
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			DialogV2: { wait: async () => null, input: async () => null },
		},
	},
	utils: { fromUuidSync: () => null },
};

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, describe, expect, it } from "bun:test";
import { boardingRowHandlers, boardingRowKey } from "./ship-boarding";

describe("boarding row dispatch vocabulary (bead w98s)", () => {
	it("normalises the canonical printed row names to machine keys", () => {
		expect(boardingRowKey("Ramming")).toBe("ramming");
		expect(boardingRowKey("Boarding")).toBe("boarding");
		expect(boardingRowKey("Break Free")).toBe("break-free");
		expect(boardingRowKey("Rout")).toBe("rout");
	});

	it("resolves the Boarding Actions full heading as the lock row", () => {
		// The printed subsection heading (Core Rulebook p215) aliases the
		// lock entry.
		expect(boardingRowKey("Boarding Actions")).toBe("boarding-actions");
		expect(boardingRowHandlers[boardingRowKey("Boarding Actions")]).toBe(
			boardingRowHandlers[boardingRowKey("Boarding")],
		);
	});

	it("carries prepare for every row, after for the machinery rows", () => {
		for (const [key, row] of Object.entries(boardingRowHandlers)) {
			expect(typeof row.prepare, `row ${key}`).toBe("function");
			// Break-free and rout resolve through their own prompt machinery.
			if (key === "break-free" || key === "rout") {
				expect(typeof row.after, `row ${key}`).toBe("function");
			}
		}
		// The ram and lock rows carry their after-effects too (the four
		// machinery rows' surface — the bead's map).
		expect(typeof boardingRowHandlers.ramming.after).toBe("function");
		expect(typeof boardingRowHandlers.boarding.after).toBe("function");
	});

	it("falls through to the standard path on an unknown/renamed row", () => {
		// A renamed item loses its machinery silently — the canonical names
		// are the contract the pack/UI surfaces must use.
		expect(boardingRowKey("Ram the Barge!")).toBe("ram-the-barge");
		expect(
			boardingRowHandlers[boardingRowKey("Ram the Barge!")],
		).toBeUndefined();
	});
});
