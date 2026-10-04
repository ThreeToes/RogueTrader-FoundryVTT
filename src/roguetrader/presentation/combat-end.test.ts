/**
 * Encounter-end status cleanup tests (bead cneb).
 *
 * - scan guards: the deleteCombat hook is wired (bootstrap/hooks.ts registers
 *   the adapter, presentation/combat-end.ts hooks "deleteCombat") — static
 *   assertions, the source-scan precedent (dynasty-sheet-form.test.ts);
 * - adapter: with FAKED combat/actor documents and faked ports, ending the
 *   encounter deletes each combatant's encounter-length effects EXACTLY ONCE
 *   via the existing ports.actors.deleteEffects write path (loud-failure
 *   contract, bead c9s3); non-encounter and self-expiring effects are left
 *   alone and non-driving users never write.
 *
 * Pure mapping tests live in rules/conditions.test.ts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getPorts, resetPorts, setPorts } from "../infrastructure/foundry/ports";
import type { EncounterEndEffectLike } from "../rules/conditions";

const globals = globalThis as Record<string, unknown>;
const original: Record<string, unknown> = {
	Hooks: globals.Hooks,
	game: globals.game,
};

afterEach(() => {
	resetPorts();
	globals.Hooks = original.Hooks;
	globals.game = original.game;
});

describe("hook-registration scan guard (bead cneb)", () => {
	test("bootstrap/hooks.ts registers the combat-end cleanup", () => {
		const source = readFileSync(
			new URL("../bootstrap/hooks.ts", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(/registerCombatEncounterEndHook\(\)/);
	});

	test("the adapter hooks deleteCombat (v14 runtime: delete+documentName)", () => {
		const source = readFileSync(
			new URL("./combat-end.ts", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(/Hooks\.on\(\s*"deleteCombat"/);
		// The single-executor guard: the hook fires on every connected client.
		expect(source).toMatch(/userId !== \(game as \{ userId\?: string \}\)\.userId/);
	});
});

// ---------------------------------------------------------------------------
// Adapter: faked documents via the ports seam.
// ---------------------------------------------------------------------------

function fakeEffect(
	id: string,
	statuses: string[],
	duration?: EncounterEndEffectLike["duration"],
): EncounterEndEffectLike {
	return { id, statuses, duration };
}

interface FakeActor {
	name: string;
	effects: EncounterEndEffectLike[];
}

function fakeCombat(
	actors: Array<{ actor: FakeActor | null }>,
): {
	combatants: Array<{ actor: unknown }>;
} {
	return { combatants: actors.map((a) => ({ actor: a.actor })) };
}

async function registerHook(): Promise<
	(combat: unknown, options: unknown, userId: string) => void
> {
	let captured: ((combat: unknown, options: unknown, userId: string) => void) | null =
		null;
	globals.Hooks = {
		on: (name: string, fn: unknown) => {
			if (name === "deleteCombat") captured = fn as typeof captured;
		},
	};
	globals.game = { userId: "gm-user" };
	const { registerCombatEncounterEndHook } = await import("./combat-end");
	registerCombatEncounterEndHook();
	if (!captured) throw new Error("deleteCombat hook was not registered");
	// biome ignores non-null narrowing here: captured is assigned above.
	return captured as NonNullable<typeof captured>;
}

describe("removeEncounterLengthConditions (bead cneb adapter)", () => {
	test("deletes only encounter-length effects, once per distinct actor", async () => {
		const deleted: Array<{ actor: unknown; ids: string[] }> = [];
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				deleteEffects: async (actor, ids) => {
					deleted.push({ actor, ids });
				},
			},
		});
		// Carried: encounter-length shaken, TIMED frozen (self-expiring),
		// a non-system status a GM applied — only the shaken goes.
		const attacker: FakeActor = {
			name: "attacker",
			effects: [
				fakeEffect("ae-shaken", ["shaken"]),
				fakeEffect("ae-frozen-timed", ["frozen"], { rounds: 5 }),
				fakeEffect("ae-dead", ["dead"]),
			],
		};
		const victim: FakeActor = {
			name: "victim",
			effects: [fakeEffect("ae-fleeing", ["fleeing"]), fakeEffect("ae-snapped", ["unnerved"])],
		};
		const bystander: FakeActor = { name: "bystander", effects: [] };
		const combat = fakeCombat([
			{ actor: attacker },
			{ actor: victim },
			{ actor: bystander },
			{ actor: null }, // unlinked/removed combatant
		]);
		const hook = await registerHook();
		hook(combat, {}, "gm-user");
		await removeEncounterPromise();
		// Exactly ONE write per affected actor, full id list, nothing else.
		expect(deleted).toEqual([
			{ actor: attacker, ids: ["ae-shaken"] },
			{ actor: victim, ids: ["ae-fleeing", "ae-snapped"] },
		]);
	});

	test("repeated combatant slots for one actor still delete once", async () => {
		const deleted: Array<{ actor: unknown; ids: string[] }> = [];
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				deleteEffects: async (actor, ids) => {
					deleted.push({ actor, ids });
				},
			},
		});
		const actor: FakeActor = {
			name: "twin-tokens",
			effects: [fakeEffect("ae-1", ["frenzied"])],
		};
		const combat = fakeCombat([
			{ actor },
			{ actor }, // second token of the same actor
		]);
		const hook = await registerHook();
		hook(combat, {}, "gm-user");
		await removeEncounterPromise();
		expect(deleted).toEqual([{ actor, ids: ["ae-1"] }]);
	});

	test("a non-driving user's deleteCombat never writes", async () => {
		let deleted = 0;
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				deleteEffects: async () => {
					deleted += 1;
				},
			},
		});
		const actor: FakeActor = {
			name: "shaken",
			effects: [fakeEffect("ae-shaken", ["shaken"])],
		};
		const hook = await registerHook();
		hook(fakeCombat([{ actor }]), {}, "player-user");
		await removeEncounterPromise();
		expect(deleted).toBe(0);
	});

	test("a write that would be dropped fails loudly (c9s3 contract)", async () => {
		const errors: string[] = [];
		const savedError = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args.join(" "));
		};
		let rejected: ((error: unknown) => void) | null = null;
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				deleteEffects: async () =>
					new Promise((_resolve, reject) => {
						rejected = reject;
					}),
			},
		});
		const actor: FakeActor = {
			name: "shaken",
			effects: [fakeEffect("ae-shaken", ["shaken"])],
		};
		const hook = await registerHook();
		hook(fakeCombat([{ actor }]), {}, "gm-user");
		// Drive the port's rejection to deterministic conclusion.
		const failure = new Error("actors.deleteEffects — document is missing");
		if (rejected) (rejected as (error: unknown) => void)(failure);
		await removeEncounterPromise();
		console.error = savedError;
		expect(errors.some((e) => e.includes("encounter-end condition cleanup failed"))).toBe(
			true,
		);
	});
});

/**
 * The hook handler does not await the cleanup; a macrotask turn lets the
 * recorded promise chain settle for the assertions above.
 */
function removeEncounterPromise(): Promise<unknown> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}