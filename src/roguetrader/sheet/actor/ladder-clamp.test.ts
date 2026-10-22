/**
 * Both ladder setters clamp to the shared LADDER_MAX (bead v99r): the NPC
 * sheet hard-coded Math.min(3, ...) while the character sheet did not clamp
 * at all (a ladder of 99 was writable). The pin makes the two setters agree
 * and fail loudly if either loses the cap again.
 *
 * The character sheet's setter is its public setLadder action; the NPC's is
 * the module-level setNpcLadder (its imperative select wiring uses the same
 * export). Foundry-coupled modules; the foundry global gets the stub pattern
 * creators.test.ts uses. No mock.module (bun test shares one process).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { LADDER_MAX } from "../skills-domain";

const originalGlobals = {
	foundry: (globalThis as Record<string, unknown>).foundry,
	game: (globalThis as Record<string, unknown>).game,
};

(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		sheets: { ActorSheetV2: class {} },
	},
	documents: { Actor: class {}, Item: class {} },
	utils: { mergeObject: () => undefined },
	config: {},
	hooks: { on() { /* stub */ } },
};
(globalThis as Record<string, unknown>).game = {
	i18n: { localize: (k: string) => k, format: (k: string) => k },
};

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

/** A fake owned skill item — the exact surface each setter touches. */
function fakeItem(ladder?: number) {
	return {
		id: "skill1",
		type: "skill",
		system: { ladder },
		updates: [] as Array<{ system?: { ladder?: number } }>,
		deleted: false,
		update(data: { system?: { ladder?: number } }) {
			this.updates.push(data);
			// Keep the fake live so a second update reads the new value.
			this.system = { ...this.system, ...(data.system ?? {}) };
			return Promise.resolve();
		},
		delete() {
			this.deleted = true;
			return Promise.resolve();
		},
	};
}

function fakeActor(item: ReturnType<typeof fakeItem>) {
	return { items: new Map([[item.id, item]]) };
}

type SetLadderAction = (
	this: unknown,
	_event: unknown,
	target: HTMLElement,
) => Promise<void>;

describe("ladder clamp (bead v99r)", () => {
	test("character sheet: an out-of-range ladder click clamps to LADDER_MAX", async () => {
		const { CharacterSheet } = await import("./character-sheet");
		const setLadder = (
			CharacterSheet as unknown as {
				DEFAULT_OPTIONS: { actions: { setLadder: SetLadderAction } };
			}
		).DEFAULT_OPTIONS.actions.setLadder;
		const item = fakeItem(1);
		const target = {
			dataset: { item: item.id, value: "99" },
		} as unknown as HTMLElement;
		await setLadder.call({ actor: fakeActor(item) as never }, {}, target);
		expect(item.updates[0]?.system?.ladder).toBe(LADDER_MAX);
	});

	test("character sheet: below-range values clamp up to 1", async () => {
		const { CharacterSheet } = await import("./character-sheet");
		const setLadder = (
			CharacterSheet as unknown as {
				DEFAULT_OPTIONS: { actions: { setLadder: SetLadderAction } };
			}
		).DEFAULT_OPTIONS.actions.setLadder;
		const item = fakeItem(2);
		const target = {
			dataset: { item: item.id, value: "0" },
		} as unknown as HTMLElement;
		await setLadder.call({ actor: fakeActor(item) as never }, {}, target);
		expect(item.updates[0]?.system?.ladder).toBe(1);
	});

	test("character sheet: clicking the active ladder still deletes (toggle-off)", async () => {
		const { CharacterSheet } = await import("./character-sheet");
		const setLadder = (
			CharacterSheet as unknown as {
				DEFAULT_OPTIONS: { actions: { setLadder: SetLadderAction } };
			}
		).DEFAULT_OPTIONS.actions.setLadder;
		const item = fakeItem(2);
		const target = {
			dataset: { item: item.id, value: "2" },
		} as unknown as HTMLElement;
		await setLadder.call({ actor: fakeActor(item) as never }, {}, target);
		expect(item.deleted).toBe(true);
		expect(item.updates).toHaveLength(0);
	});

	test("npc sheet: an out-of-range ladder select clamps to LADDER_MAX (and below-range clamps to 1)", async () => {
		const { setNpcLadder } = await import("./npc-sheet");
		const item = fakeItem(1);
		await setNpcLadder(fakeActor(item) as never, item.id, 99);
		expect(item.updates[0]?.system?.ladder).toBe(LADDER_MAX);
		await setNpcLadder(fakeActor(item) as never, item.id, 0);
		expect(item.updates[1]?.system?.ladder).toBe(1);
	});

	test("LADDER_MAX is the three-step cap the module documents", () => {
		expect(LADDER_MAX).toBe(3);
	});
});