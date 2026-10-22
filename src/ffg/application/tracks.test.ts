/**
 * adjustTrack — the shared insanity/corruption arithmetic (bead u9fz, 08jl).
 *
 * The clamp-at-zero, the no-op and the corrupt-current fallback were written
 * but never executed by the positive-gains-only fear/psychic-support tests;
 * a wrong clamp here would push negative points into the tracks.
 *
 * Pure port pattern: the Actors port is a recording fake (foundry-schema
 * free — adjustTrack only needs the port).
 */
import { describe, expect, test } from "bun:test";
import { adjustTrack } from "./tracks";

/** Actors port fake that records every update patch. */
const recordingActors = () => {
	const patches: Array<Record<string, unknown>> = [];
	return {
		patches,
		actors: {
			update: async (
				_actor: unknown,
				patch: Record<string, unknown>,
			): Promise<void> => {
				patches.push(patch);
			},
			createEffects: async (): Promise<void> => undefined,
			deleteEffects: async (): Promise<void> => undefined,
		},
	};
};

const actorOf = (system: Record<string, unknown>) => ({ system });

describe("adjustTrack clamping and no-ops (bead 08jl)", () => {
	test("a reduction below zero CLAMPS at 0 and writes 0, not -5", async () => {
		const { actors, patches } = recordingActors();
		const actor = actorOf({ insanity: 0 });
		await adjustTrack(actors, actor, "insanity", -5);
		// Tracks are monotonic counters: zero points means zero points.
		expect(patches).toEqual([{ "system.insanity": 0 }]);
	});

	test("a reduction that fits is written unchanged", async () => {
		const { actors, patches } = recordingActors();
		await adjustTrack(
			actors,
			actorOf({ insanity: 7 }),
			"insanity",
			-3,
		);
		expect(patches).toEqual([{ "system.insanity": 4 }]);
	});

	test("a positive gain adds normally", async () => {
		const { actors, patches } = recordingActors();
		const applied = await adjustTrack(
			actors,
			actorOf({ insanity: 5 }),
			"insanity",
			10,
		);
		expect(patches).toEqual([{ "system.insanity": 15 }]);
		expect(applied).toBe(10);
	});

	test("a non-finite delta (NaN) is a no-op: returns 0, writes NOTHING", async () => {
		const { actors, patches } = recordingActors();
		const applied = await adjustTrack(
			actors,
			actorOf({ insanity: 5 }),
			"insanity",
			Number.NaN,
		);
		expect(applied).toBe(0);
		expect(patches).toEqual([]);
	});

	test("an infinite delta is a no-op too", async () => {
		const { actors, patches } = recordingActors();
		const applied = await adjustTrack(
			actors,
			actorOf({ insanity: 5 }),
			"insanity",
			Number.POSITIVE_INFINITY,
		);
		expect(applied).toBe(0);
		expect(patches).toEqual([]);
	});

	test("a zero delta is a no-op", async () => {
		const { actors, patches } = recordingActors();
		const applied = await adjustTrack(
			actors,
			actorOf({ insanity: 5 }),
			"insanity",
			0,
		);
		expect(applied).toBe(0);
		expect(patches).toEqual([]);
	});

	test("an ABSENT current field falls back to 0", async () => {
		const { actors, patches } = recordingActors();
		// No insanity field at all — the raw Number(undefined) is NaN, the
		// fallback path.
		await adjustTrack(actors, actorOf({}), "insanity", 5);
		expect(patches).toEqual([{ "system.insanity": 5 }]);
	});

	test("a CORRUPT (non-numeric) current field falls back to 0", async () => {
		const { actors, patches } = recordingActors();
		await adjustTrack(
			actors,
			actorOf({ insanity: "banana" }),
			"insanity",
			3,
		);
		expect(patches).toEqual([{ "system.insanity": 3 }]);
	});

	test("a corrupt current + negative delta clamps at 0", async () => {
		const { actors, patches } = recordingActors();
		await adjustTrack(
			actors,
			actorOf({ corruption: "corrupt" }),
			"corruption",
			-9,
		);
		expect(patches).toEqual([{ "system.corruption": 0 }]);
	});

	test("the corruption field works symmetrically", async () => {
		const { actors, patches } = recordingActors();
		await adjustTrack(actors, actorOf({ corruption: 20 }), "corruption", 5);
		expect(patches).toEqual([{ "system.corruption": 25 }]);
	});
});