/**
 * toggleSustainedPower — the sustained-powers list write (bead sa6, 6v9n).
 *
 * The only writer of `system.sustainedPowers`, which rules/psychic.ts reads
 * back through effectivePsyRating's sustainedCount. Until now no test drove
 * it, so an append that dropped the existing entries (or an off-by-one
 * filter) would silently change every psyker's effective Psy Rating.
 *
 * Adapter-level test via the roll-pipeline fake-globals harness (the
 * adapter-ammo-consume.test.ts pattern): Foundry globals are stubbed before
 * the dynamic import because the adapter module graph transitively loads
 * test-dialog, which destructures foundry.applications.api at load.
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
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
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
};

const { toggleSustainedPower } = await import("./adapter");

import { afterAll, describe, expect, test } from "bun:test";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

// --- Fixtures -------------------------------------------------------------

/** A minimal writable actor whose system merges (Foundry) and records patches. */
const sustainedActor = (sustainedPowers?: unknown) => {
	const patches: Array<Record<string, unknown>> = [];
	const system: Record<string, unknown> = sustainedPowers
		? { sustainedPowers }
		: {};
	const actor = {
		type: "npc",
		system,
		uuid: "Actor.s",
		update: async (patch: object): Promise<void> => {
			const p = patch as { system?: Record<string, unknown> };
			if (p.system) Object.assign(system, p.system);
			patches.push(patch as Record<string, unknown>);
		},
		patches,
	};
	return actor;
};

const power = (itemUuid: string, name: string) => ({ itemUuid, name });

describe("toggleSustainedPower (bead 6v9n, book p157)", () => {
	test("toggling an ABSENT power appends {itemUuid, name}", async () => {
		const actor = sustainedActor(undefined);
		await toggleSustainedPower(actor as never, "Actor.s.Item.p1", "Smite");
		// The FULL array is written, not a delta document-update element key —
		// psychic.ts reads the array's length for effectivePsyRating.
		expect(actor.patches).toEqual([
			{
				system: {
					sustainedPowers: [power("Actor.s.Item.p1", "Smite")],
				},
			},
		]);
		// The merged system now carries it (the sheet re-renders from this).
		expect(actor.system.sustainedPowers).toEqual([
			power("Actor.s.Item.p1", "Smite"),
		]);
	});

	test("toggling onto an EXISTING list appends without dropping prior entries", async () => {
		const actor = sustainedActor([
			power("Actor.s.Item.a", "Smite"),
		]);
		await toggleSustainedPower(actor as never, "Actor.s.Item.b", "Force Barrage");
		expect(actor.patches).toEqual([
			{
				system: {
					sustainedPowers: [
						power("Actor.s.Item.a", "Smite"),
						power("Actor.s.Item.b", "Force Barrage"),
					],
				},
			},
		]);
	});

	test("toggling a PRESENT power removes exactly it and keeps the rest", async () => {
		const actor = sustainedActor([
			power("Actor.s.Item.a", "Smite"),
			power("Actor.s.Item.b", "Force Barrage"),
			power("Actor.s.Item.c", "Warp Speed"),
		]);
		await toggleSustainedPower(actor as never, "Actor.s.Item.b", "Force Barrage");
		expect(actor.patches).toEqual([
			{
				system: {
					sustainedPowers: [
						power("Actor.s.Item.a", "Smite"),
						power("Actor.s.Item.c", "Warp Speed"),
					],
				},
			},
		]);
	});

	test("a toggle round-trip (on then off) restores the empty list", async () => {
		const actor = sustainedActor([]);
		await toggleSustainedPower(actor as never, "Actor.s.Item.p1", "Smite");
		await toggleSustainedPower(actor as never, "Actor.s.Item.p1", "Smite");
		expect(actor.patches).toEqual([
			{
				system: { sustainedPowers: [power("Actor.s.Item.p1", "Smite")] },
			},
			{ system: { sustainedPowers: [] } },
		]);
		expect(actor.system.sustainedPowers).toEqual([]);
	});
});