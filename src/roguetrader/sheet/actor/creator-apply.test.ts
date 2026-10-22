/**
 * The shared create-vs-update branching (bead w7zm): createOrUpdateActor
 * in creator-apply.ts, asserted with fake `Actor.create` / `actor.update`
 * calls. The module is the sheet edge, so the test uses the same Foundry
 * globals shim + dynamic-import pattern as creators.test.ts and then
 * restores the globals.
 */
import { afterAll, describe, expect, test } from "bun:test";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;

let confirmCalls = 0;
let confirmAnswer = true;
let chatPosts: string[] = [];

globals.game = {
	i18n: {
		localize: (key: string) => `L10N[${key}]`,
		format: (key: string) => `F[${key}]`,
	},
	system: { id: "rogue-trader" },
};
globals.ui = {
	notifications: { warn: () => undefined, info: () => undefined },
};
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: {
				wait: async () => null,
				input: async () => null,
				confirm: async () => {
					confirmCalls++;
					return confirmAnswer;
				},
			},
		},
		handlebars: {
			renderTemplate: async () => "",
			getTemplate: async () => () => "",
		},
	},
	handlebars: {
		renderTemplate: async () => "",
		getTemplate: async () => () => "",
	},
	documents: {
		Item: class {},
		/** Fake Actor class: create() records and hands back the passed data. */
		Actor: class {
			static created: object[] = [];
			name?: string;
			type?: string;
			system?: object;
			items?: unknown[];
			sheet?: { render: (o?: object) => unknown };
			static async create(data: object) {
				(this as unknown as { created: object[] }).created.push(data);
				const actor = new this() as unknown as {
					name?: string;
					type?: string;
					system?: object;
					sheet?: { render: () => void };
					uuid: string;
					updateCalls: object[];
					createCalls: number;
					deleteCalls: number;
					items: unknown[];
				};
				const d = data as {
					name?: string;
					type?: string;
					system?: object;
				};
				actor.name = d.name;
				actor.type = d.type;
				actor.system = d.system;
				actor.uuid = "Actor.new";
				actor.items = [];
				actor.updateCalls = [];
				actor.createCalls = 0;
				actor.deleteCalls = 0;
				return actor;
			}
		},
		ChatMessage: {
			create: async (data: { content?: string }) => {
				chatPosts.push(data.content ?? "");
				return { id: "m1" };
			},
		},
	},
	utils: { mergeObject: () => undefined },
};

const { createOrUpdateActor } = await import("./creator-apply");

import { originLedgerEntry, totalSpent, type AdvanceLedgerEntry } from "../../rules/advancement";
import type { ApplyableActor } from "./creator-apply";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

function fakeActor(overrides: Record<string, unknown> = {}): {
	actor: ApplyableActor;
	calls: object[];
} {
	const calls: object[] = [];
	const actor = {
		name: "Old Name",
		uuid: "Actor.abc",
		update: async (data: object) => {
			calls.push(data);
			return data;
		},
		createEmbeddedDocuments: async () => [],
		deleteEmbeddedDocuments: async () => [],
		items: [],
		sheet: { render: () => undefined },
		system: { xp: { spent: 0, total: 0 } },
		__calls: calls,
		...overrides,
	} as unknown as ApplyableActor;
	return { actor, calls };
}

const PAYLOAD = {
	name: "New Name",
	type: "explorer",
	system: { careerKey: "arch-militant" },
};

describe("createOrUpdateActor — create branch (bead w7zm)", () => {
	test("no target actor: Actor.create(payload) with the localized fallback name", async () => {
		const {
			documents: { Actor },
		} = globals.foundry as unknown as {
			documents: { Actor: { created: object[] } };
		};
		Actor.created.length = 0;
		let applied: unknown;
		let closed = false;
		const ok = await createOrUpdateActor(
			null,
			{ ...PAYLOAD, name: "" },
			async (actor) => {
				applied = actor;
			},
			{
				fallbackNameKey: "CREATOR.DEFAULT_NAME",
				close: () => {
					closed = true;
				},
			},
		);
		expect(ok).toBe(true);
		expect(Actor.created).toHaveLength(1);
		const created = Actor.created[0] as Record<string, unknown>;
		expect(created.type).toBe("explorer");
		expect(created.name).toBe("L10N[CREATOR.DEFAULT_NAME]");
		expect(created.system).toEqual(PAYLOAD.system);
		expect(applied).not.toBeNull();
		expect(closed).toBe(true);
	});

	test("Actor.create returning nothing -> false, no apply, no close", async () => {
		fakeActor();
		const original = (
			globals.foundry as unknown as {
				documents: { Actor: { create: (d: object) => Promise<unknown> } };
			}
		).documents.Actor.create;
		const Actor = globals.foundry as unknown as {
			documents: {
				Actor: { create: (d: object) => Promise<unknown> };
			};
		};
		Actor.documents.Actor.create = async () => undefined;
		try {
			let applied = false;
			const ok = await createOrUpdateActor(
				null,
				PAYLOAD,
				async () => {
					applied = true;
				},
				{ fallbackNameKey: "X", close: () => undefined },
			);
			expect(ok).toBe(false);
			expect(applied).toBe(false);
		} finally {
			Actor.documents.Actor.create = original;
		}
		fakeActor();
	});
});

describe("createOrUpdateActor — update branch (bead w7zm)", () => {
	test("target actor + confirmOverwrite with content: confirms, updates, applies", async () => {
		confirmCalls = 0;
		confirmAnswer = true;
		const { actor: target, calls } = fakeActor({
			items: [{ id: "i1" }],
		});
		let appliedTo: unknown = null;
		let closed = false;
		const ok = await createOrUpdateActor(
			target,
			PAYLOAD,
			async (actor) => {
				appliedTo = actor;
			},
			{
				confirmOverwrite: true,
				fallbackNameKey: "CREATOR.DEFAULT_NAME",
				close: () => {
					closed = true;
				},
			},
		);
		expect(ok).toBe(true);
		expect(confirmCalls).toBe(1);
		const updates = calls;
		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({
			name: "New Name",
			system: PAYLOAD.system,
		});
		expect(appliedTo).toBe(target);
		expect(closed).toBe(true);
	});

	test("the DECLINED overwrite applies nothing", async () => {
		confirmCalls = 0;
		confirmAnswer = false;
		const { actor: target, calls } = fakeActor({
			system: { xp: { spent: 100, total: 5000 } },
		});
		let applied = false;
		let closed = false;
		const ok = await createOrUpdateActor(
			target,
			PAYLOAD,
			async () => {
				applied = true;
			},
			{
				confirmOverwrite: true,
				fallbackNameKey: "X",
				close: () => {
					closed = true;
				},
			},
		);
		expect(ok).toBe(false);
		expect(confirmCalls).toBe(1);
		expect(applied).toBe(false);
		expect(closed).toBe(false);
		expect(calls).toHaveLength(0);
	});

	test("a BLANK actor updates silently even with confirmOverwrite", async () => {
		confirmCalls = 0;
		confirmAnswer = true;
		const { actor: target, calls } = fakeActor();
		let applied = false;
		const ok = await createOrUpdateActor(
			target,
			{ ...PAYLOAD, name: "" },
			async () => {
				applied = true;
			},
			{
				confirmOverwrite: true,
				fallbackNameKey: "X",
				close: () => undefined,
			},
		);
		expect(ok).toBe(true);
		expect(confirmCalls).toBe(0); // blank new PCs apply silently
		expect(applied).toBe(true);
		const updates = calls;
		expect(updates[0]).toEqual({
			name: "Old Name", // payload name "" falls back to the existing name
			system: PAYLOAD.system,
		});
	});

	test("NO confirmOverwrite (the ship-creator asymmetry): no dialog ever", async () => {
		confirmCalls = 0;
		confirmAnswer = false;
		const { actor: target } = fakeActor({
			system: { xp: { spent: 100, total: 5000 } }, // has content
		});
		let applied = false;
		const ok = await createOrUpdateActor(
			target,
			PAYLOAD,
			async () => {
				applied = true;
			},
			{ fallbackNameKey: "X", close: () => undefined },
		);
		expect(ok).toBe(true);
		expect(confirmCalls).toBe(0); // the ship path has no confirm dialog
		expect(applied).toBe(true);
	});

	// Bead 9o5z regression pin: the character creator's payload carries the
	// creation-baseline origin ledger entry under system.advances; the update
	// branch must MERGE it into the actor's purchase history (not overwrite
	// it wholesale) and recompute xp.spent from the merged ledger.
	test("a payload WITH an advances ledger merges into the actor's purchases (ledger splice)", async () => {
		const purchase: AdvanceLedgerEntry = {
			type: "skill",
			key: "awareness",
			name: "Awareness",
			cost: 100,
			rank: 1,
		};
		const baseline = [originLedgerEntry("Origin Path: Survivalist", 300)];
		const { actor: target, calls } = fakeActor({
			system: {
				advances: [purchase],
				xp: { spent: 4600, total: 5000 },
			},
		});
		const payloadSystem = {
			careerKey: "arch-militant",
			advances: structuredClone(baseline),
			xp: { total: 5000, spent: 300 },
		};
		const ok = await createOrUpdateActor(
			target,
			{ name: "New Name", type: "explorer", system: payloadSystem },
			async () => undefined,
			{ fallbackNameKey: "X", close: () => undefined },
		);
		expect(ok).toBe(true);
		expect(calls).toHaveLength(1);
		const system = (calls[0] as { system?: Record<string, unknown> }).system!;
		// The merged array: prior purchase first, baseline appended after it.
		expect(system.advances).toEqual([...[purchase], ...baseline]);
		// xp.spent recomputed FROM the merged ledger (4500 baseline + 400).
		expect(system.xp).toEqual({ total: 5000, spent: totalSpent(system.advances as never) });
		expect(system.xp).toEqual({ total: 5000, spent: 4900 });
		// Everything else of the payload passes through.
		expect(system.careerKey).toBe("arch-militant");
	});

	test("a ship-shaped payload WITHOUT advances passes system through verbatim", async () => {
		const { actor: target, calls } = fakeActor({
			system: { xp: { spent: 100, total: 5000 } },
		});
		const shipSystem = { hull: 40, crew: { rating: 30 } };
		const ok = await createOrUpdateActor(
			target,
			{ name: "New Ship", type: "starship", system: shipSystem },
			async () => undefined,
			{ fallbackNameKey: "X", close: () => undefined },
		);
		expect(ok).toBe(true);
		expect(calls).toHaveLength(1);
		// No ledger merge, no xp rewrite — the system object verbatim.
		expect(calls[0]).toEqual({ name: "New Ship", system: shipSystem });
	});
});
