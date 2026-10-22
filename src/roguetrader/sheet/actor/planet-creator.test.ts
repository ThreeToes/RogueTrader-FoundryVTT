/**
 * Planet creator's finish edge (shared-helper bead): #onFinish must run the
 * shared createOrUpdateActor (creator-apply.ts, the ship creator's edge)
 * instead of its own update-vs-create clone, and reconcile stale rows
 * through the shared creatorGrantIds (grantedBy "planet-creator",
 * type "game-table"). Asserted with fake `Actor.create` / `actor.update`
 * calls — the same Foundry globals shim + dynamic-import pattern as
 * creators.test.ts and creator-apply.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;

const uuidDocs: Record<string, unknown> = {};

globals.game = {
	i18n: { localize: (key: string) => `L10N[${key}]` },
	system: { id: "rogue-trader" },
};
globals.ui = { notifications: { warn: () => undefined, info: () => undefined } };
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { wait: async () => null, input: async () => null },
		},
		handlebars: {
			renderTemplate: async () => "",
			getTemplate: async () => () => "",
		},
	},
	handlebars: { renderTemplate: async () => "", getTemplate: async () => () => "" },
	documents: {
		Item: class {},
		Actor: class {
			static created: object[] = [];
			static async create(data: object) {
				(this as unknown as { created: object[] }).created.push(data);
				const created = data as Record<string, unknown>;
				return {
					name: created.name,
					type: created.type,
					system: created.system,
					items: [],
					createEmbeddedDocuments: async () => [],
					deleteEmbeddedDocuments: async () => [],
					sheet: { render: () => undefined },
				};
			}
		},
		ChatMessage: { get: () => undefined },
	},
	utils: {
		mergeObject: () => undefined,
		fromUuid: async (uuid: string) => uuidDocs[uuid] ?? null,
	},
};

const { PlanetCreator } = await import("./planet-creator");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

/** Every stage key present, one draw only on `body` (one attached row). */
function withBodyDraw(
	instance: { stages: Record<string, unknown> },
	uuid: string,
): void {
	const stages: Record<string, { uuid: string; name: string }> = {};
	for (const key of Object.keys(instance.stages)) {
		stages[key] = { uuid: "", name: "" };
	}
	stages.body = { uuid, name: "Low-Mass Body" };
	instance.stages = stages as never;
}

/**
 * A fake planet actor for the right-click update path: one stale
 * creator-installed row, one manual drag-attached row (no flag).
 */
function fakePlanetActor(items: Array<{ id: string; type: string; system?: { grantedBy?: string } }>) {
	const calls: { updates: object[]; deletes: string[][]; creates: object[][] } = {
		updates: [],
		deletes: [],
		creates: [],
	};
	const actor = {
		name: "Old Planet",
		items,
		update: async (data: object) => {
			calls.updates.push(data);
			return data;
		},
		createEmbeddedDocuments: async (
			_t: string,
			data: object[],
		) => {
			calls.creates.push(data);
			return data;
		},
		deleteEmbeddedDocuments: async (_t: string, ids: string[]) => {
			calls.deletes.push(ids);
			return ids;
		},
		sheet: { render: () => undefined },
		__calls: calls,
	};
	return { actor, calls };
}
function finishOf(ctor: unknown): (this: unknown) => Promise<void> {
	return (
		(
			ctor as {
				DEFAULT_OPTIONS: {
					actions: Record<string, (this: unknown) => Promise<void>>;
				};
			}
		).DEFAULT_OPTIONS.actions.finish
	);
}

describe("planet creator finish (shared-helper bead)", () => {
	test("update path: routes through createOrUpdateActor — update + reconcile + close + render", async () => {
		const uuidDocsBefore = { ...uuidDocs };
		uuidDocs["Row.body"] = { name: "Low-Mass Body", system: { kind: "soi-planet-body" } };
		const { actor, calls } = fakePlanetActor([
			{ id: "stale1", type: "game-table", system: { grantedBy: "planet-creator" } },
			{ id: "manual", type: "game-table" }, // manual drag — must survive
			{ id: "other", type: "skill", system: { grantedBy: "planet-creator" } },
		]);
		const instance = new PlanetCreator({
			actor: actor as never,
		} as never) as unknown as {
			name: string;
			profile: Record<string, string>;
			targetActor: unknown;
			stages: never;
			close: () => undefined;
		};
		let closed = 0;
		(instance as unknown as { close: () => void }).close = () => {
			closed++;
		};
		instance.name = "Korsisa Secundus";
		instance.profile = { body: "Low-Mass Body" };
		withBodyDraw(instance as never, "Row.body");
		await finishOf(PlanetCreator).call(instance);
		// One system update carrying the profile payload (no name update —
		// payload.name wins).
		expect(calls.updates).toHaveLength(1);
		expect(calls.updates[0]).toEqual({
			name: "Korsisa Secundus",
			system: { body: "Low-Mass Body" },
		});
		// The reconcile deletes ONLY planet-creator game-table rows; manual
		// drops and non-table flags survive.
		expect(calls.deletes).toEqual([["stale1"]]);
		expect(calls.creates).toHaveLength(1);
		const created = calls.creates[0] as Array<Record<string, unknown>>;
		expect(created).toHaveLength(1);
		expect(created[0].name).toBe("Low-Mass Body");
		expect((created[0].system as Record<string, unknown>).grantedBy).toBe(
			"planet-creator",
		);
		expect(closed).toBe(1);
		// Restore the shared docs record (tests are sequential but be safe).
		for (const key of Object.keys(uuidDocs)) delete uuidDocs[key];
		Object.assign(uuidDocs, uuidDocsBefore);
	});

	test("update path with an empty wizard name: falls back to the actor's existing name", async () => {
		const { actor, calls } = fakePlanetActor([]);
		const instance = new PlanetCreator({ actor: actor as never } as never) as unknown as {
			name: string;
			profile: Record<string, string>;
			stages: never;
		};
		(instance as unknown as { close: () => void }).close = () => undefined;
		instance.name = "";
		instance.profile = { gravity: "Normal" };
		withBodyDraw(instance as never, "");
		await finishOf(PlanetCreator).call(instance);
		expect(calls.updates[0]).toEqual({ name: "Old Planet", system: { gravity: "Normal" } });
	});

	test("create path: no target actor — Actor.create with the localized fallback name", async () => {
		const Actor = (globals.foundry as unknown as {
			documents: { Actor: { created: object[] } };
		}).documents.Actor;
		Actor.created.length = 0;
		uuidDocs["Row.body"] = { name: "Low-Mass Body", system: {} };
		const instance = new PlanetCreator() as unknown as {
			name: string;
			profile: Record<string, string>;
			stages: never;
			close: () => void;
		};
		let closed = 0;
		(instance as unknown as { close: () => void }).close = () => {
			closed++;
		};
		instance.name = "";
		instance.profile = { atmosphere: "None" };
		withBodyDraw(instance as never, "Row.body");
		await finishOf(PlanetCreator).call(instance);
		expect(Actor.created).toHaveLength(1);
		const created = Actor.created[0] as Record<string, unknown>;
		expect(created.type).toBe("planet");
		expect(created.name).toBe("L10N[PLANET_CREATOR.DEFAULT_NAME]"); // shared fallbackNameKey
		expect(created.system).toEqual({ atmosphere: "None" });
		expect(closed).toBe(1);
		for (const key of Object.keys(uuidDocs)) delete uuidDocs[key];
	});
});