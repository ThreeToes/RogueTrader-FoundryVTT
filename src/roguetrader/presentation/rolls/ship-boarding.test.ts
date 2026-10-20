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
import {
	getPorts,
	resetPorts,
	setPorts,
} from "../../../ffg/infrastructure/foundry/ports";
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

describe("the rout flow's cancelled prompts (bead wu2l nit 18)", () => {
	/** The file stub's DialogV2 (restored in runRout's finally). */
	const foundryGlobal = () =>
		(globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: unknown } };
		};

	/** Run rout.after() with the given prompt sequence scripted; captures
	 * the posted cards and the actor writes; restores stubs + ports. */
	const runRout = async (dialog: {
		wait: (opts?: unknown) => Promise<unknown>;
		input: (opts?: unknown) => Promise<unknown>;
	}) => {
		const original = foundryGlobal().applications.api.DialogV2;
		foundryGlobal().applications.api.DialogV2 = dialog;
		const posted: string[] = [];
		const updates: Array<Record<string, unknown>> = [];
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				update: async (_doc: unknown, data: Record<string, unknown>) => {
					updates.push(data);
				},
			},
			targets: {
				...getPorts().targets,
				actor: () => ({ name: "Enemy", system: {} }),
			},
			chat: {
				...getPorts().chat,
				postHtml: async (_actor: unknown, html: string) => {
					posted.push(html);
					return { id: "m1" };
				},
			},
		} as never);
		try {
			const after = boardingRowHandlers.rout.after;
			if (!after) throw new Error("the rout row lost its after-hook");
			await after(
				{
					kind: "ship-action",
					actor: {
						name: "Righteous Fury",
						uuid: "Actor.s1",
						system: { boardedWith: { uuid: "Actor.s2" } },
					},
					itemId: "i1",
				} as never,
				// The prepare-only rout row's prepared shape (title + kindData).
				{
					title: "Righteous Fury — SHIP_BOARDING.ROUT_TITLE",
					kindData: { name: "Rout" },
				} as never,
				{} as never,
				"",
			);
			return { posted, updates };
		} finally {
			foundryGlobal().applications.api.DialogV2 = original;
			resetPorts();
		}
	};

	it("the cancelled winner prompt posts the cancelled-state note card (never silent)", async () => {
		const { posted, updates } = await runRout({
			wait: async () => null,
			input: async () => null,
		});
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain("SHIP_BOARDING.FLOW_CANCELLED");
		// No actor write — nothing resolved.
		expect(updates).toEqual([]);
	});

	it("a cancelled degrees prompt posts the note card, writes nothing", async () => {
		const { posted, updates } = await runRout({
			// The winner prompt confirms; the degrees prompt cancels.
			wait: async () => "ship",
			input: async () => null,
		});
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain("SHIP_BOARDING.FLOW_CANCELLED");
		expect(updates).toEqual([]);
	});

	it("a cancelled per-degree pick posts the note card, writes nothing", async () => {
		const calls: string[] = [];
		const { posted, updates } = await runRout({
			// The winner prompt confirms "ship"; the per-degree PICK prompt
			// (wait again) cancels.
			wait: async () => {
				calls.push("wait");
				return calls.length === 1 ? "ship" : null;
			},
			input: async () => ({ degrees: "1" }),
		});
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain("SHIP_BOARDING.FLOW_CANCELLED");
		expect(updates).toEqual([]);
	});
});
