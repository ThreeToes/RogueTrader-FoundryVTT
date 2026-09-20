/**
 * Creator wizard shell (epic kof0, bead 7ife).
 *
 * Written BEFORE refactoring the four creators onto a shared base, because
 * there was no coverage of them at all: 3,102 lines of wizard UI and not one
 * test referenced a creator class. This pins the behaviour the shared base is
 * meant to centralise, so the migration has a safety net rather than a hope.
 *
 * It also DOCUMENTS THE DRIFT the bead is about: two of the four keep their
 * step in `creatorState.step` and two in `stepIndex`, and their finish action
 * is named `create` in one and `finish` in the other three.
 */

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
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				render(): Promise<unknown> {
					return Promise.resolve();
				}
			},
			DialogV2: { wait: async () => null, input: async () => null },
		},
		sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
		handlebars: { renderTemplate: async () => "", getTemplate: async () => () => "" },
		documents: { Item: class {}, Actor: class {}, ChatMessage: { get: () => undefined } },
		utils: { mergeObject: () => undefined },
	},
};

const { CharacterCreator } = await import("./character-creator");
const { ShipCreator } = await import("./ship-creator");
const { PlanetCreator } = await import("./planet-creator");
const { WarrantCreator } = await import("./warrant-creator");
const { CREATOR_LAST_STEP } = await import("../../rules/creation");
const { WARRANT_ROWS } = await import("../../rules/warrant");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

type CreatorInstance = {
	render: () => unknown;
	targetActor?: unknown;
};

/** One creator, plus how to read its step (the drift this bead is about). */
const CREATORS = [
	{
		label: "CharacterCreator",
		make: () => new CharacterCreator() as unknown as CreatorInstance,
		// Migrated to the shared shell (bead 7ife): `creatorState.step` -> `step`.
		step: (c: CreatorInstance) => (c as unknown as { step: number }).step,
		setStep: (c: CreatorInstance, n: number) => {
			(c as unknown as { step: number }).step = n;
		},
		last: CREATOR_LAST_STEP,
		finishAction: "finish",
	},
	{
		label: "ShipCreator",
		make: () => new ShipCreator() as unknown as CreatorInstance,
		// Migrated to the shared shell (bead 7ife): `creatorState.step` -> `step`.
		step: (c: CreatorInstance) => (c as unknown as { step: number }).step,
		setStep: (c: CreatorInstance, n: number) => {
			(c as unknown as { step: number }).step = n;
		},
		last: 2,
		finishAction: "finish",
	},
	{
		label: "PlanetCreator",
		make: () => new PlanetCreator() as unknown as CreatorInstance,
		// Migrated to the shared shell (bead 7ife): `stepIndex` -> `step`.
		step: (c: CreatorInstance) => (c as unknown as { step: number }).step,
		setStep: (c: CreatorInstance, n: number) => {
			(c as unknown as { step: number }).step = n;
		},
		// Planet stages are a module-local const; its wizard is 10 stages long
		// (body, gravity, orbital, atmosphere, composition, climate,
		// habitability, territories, inhabitants, development).
		last: 9,
		finishAction: "finish",
	},
	{
		label: "WarrantCreator",
		make: () => new WarrantCreator() as unknown as CreatorInstance,
		// Migrated to the shared shell (bead 7ife): `stepIndex` -> `step`.
		step: (c: CreatorInstance) => (c as unknown as { step: number }).step,
		setStep: (c: CreatorInstance, n: number) => {
			(c as unknown as { step: number }).step = n;
		},
		last: WARRANT_ROWS.length - 1,
		finishAction: "finish",
	},
] as const;

/**
 * Build a creator with `render` stubbed on the INSTANCE.
 *
 * Not on the prototype: whichever test file loads the creator modules first
 * fixes their base class, and several files stub ApplicationV2 differently
 * (some without `render` at all). Stubbing the instance makes this test
 * independent of load order.
 */
function makeRendered(creator: (typeof CREATORS)[number]): CreatorInstance {
	const instance = creator.make();
	(instance as unknown as { render: () => void }).render = () => undefined;
	return instance;
}

/** The action handlers a creator exposes to Foundry. */
function actionsOf(ctor: unknown): Record<string, (this: unknown) => Promise<void>> {
	return (
		ctor as { DEFAULT_OPTIONS: { actions: Record<string, never> } }
	).DEFAULT_OPTIONS.actions as unknown as Record<
		string,
		(this: unknown) => Promise<void>
	>;
}

describe("creator wizard shell (bead 7ife)", () => {
	for (const creator of CREATORS) {
		test(`${creator.label}: starts at step 0`, () => {
			expect(creator.step(creator.make())).toBe(0);
		});

		test(`${creator.label}: exposes prev/next actions`, () => {
			const ctor = creator.make().constructor;
			const actions = actionsOf(ctor);
			expect(typeof actions.prev).toBe("function");
			expect(typeof actions.next).toBe("function");
		});

		test(`${creator.label}: prev clamps at 0`, async () => {
			const instance = makeRendered(creator);
			const actions = actionsOf(instance.constructor);
			creator.setStep(instance, 0);
			await actions.prev.call(instance);
			expect(creator.step(instance)).toBe(0);
		});

		test(`${creator.label}: prev steps back from 1`, async () => {
			const instance = makeRendered(creator);
			const actions = actionsOf(instance.constructor);
			creator.setStep(instance, 1);
			await actions.prev.call(instance);
			expect(creator.step(instance)).toBe(0);
		});

		test(`${creator.label}: next clamps at the last step`, async () => {
			const instance = makeRendered(creator);
			const actions = actionsOf(instance.constructor);
			creator.setStep(instance, creator.last);
			await actions.next.call(instance);
			expect(creator.step(instance)).toBe(creator.last);
		});

		test(`${creator.label}: next advances from 0`, async () => {
			const instance = makeRendered(creator);
			const actions = actionsOf(instance.constructor);
			creator.setStep(instance, 0);
			await actions.next.call(instance);
			expect(creator.step(instance)).toBe(1);
		});

		test(`${creator.label}: has a finish action`, () => {
			const actions = actionsOf(creator.make().constructor);
			expect(typeof actions[creator.finishAction]).toBe("function");
		});

		test(`${creator.label}: a plain construction targets no actor`, () => {
			expect(creator.make().targetActor ?? null).toBeNull();
		});
	}

	test("THE SHELL CONVERGED: one step field, one finish action", () => {
		// This started as a DRIFT assertion (two names for the step, two for
		// finish) and was rewritten when bead 7ife landed, exactly as it was
		// meant to be. Every creator now shares CreatorApplication's `step` and
		// names its final action `finish`.
		for (const creator of CREATORS) {
			const instance = creator.make() as unknown as Record<string, unknown>;
			expect(typeof instance.step).toBe("number");
			expect(creator.finishAction).toBe("finish");
		}
		// And no creator keeps a step of its own in a private state object.
		for (const creator of CREATORS) {
			const state = (creator.make() as unknown as { creatorState?: object })
				.creatorState;
			if (state) expect("step" in state).toBe(false);
		}
	});

	test("every creator shares the same prev/next implementation", () => {
		// One implementation, not four copies: the handlers are the SAME
		// function reference on every creator.
		const prevs = new Set(
			CREATORS.map((c) => actionsOf(c.make().constructor).prev),
		);
		const nexts = new Set(
			CREATORS.map((c) => actionsOf(c.make().constructor).next),
		);
		expect(prevs.size).toBe(1);
		expect(nexts.size).toBe(1);
	});
});
