/**
 * fearHandler.after() condition + Insanity writes (beads eclw / 3u1p):
 *
 * - 3u1p — a combat Shock failure rolls the Insanity gain ONCE and the SAME
 *   dice result is applied to system.insanity and shown on the card (it used
 *   to roll inside applyCondition AND on the card, so the two disagreed);
 * - eclw — a non-combat failure by 30+ (4 degrees, Table 10-3 ladder,
 *   Core Rulebook p296) applies the rolled +1d5 to system.insanity, which used
 *   to be card-only (the "unnerved" condition carries insanity "0") and never
 *   reached the track;
 * - a failure under the threshold leaves system.insanity untouched.
 *
 * The Foundry globals are stubbed BEFORE the dynamic import (the pipeline
 * chain touches foundry.applications at module load); ports are swapped for
 * fakes so the whole flow runs headlessly.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Ports } from "../../../ffg/application/ports";
import type { PreparedRoll } from "../../rules/roll-contract";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

// --- Foundry/global stubs (must precede the dynamic import) ---------------
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: { localize: (key: string) => key },
	system: { id: "rogue-trader" },
	user: { isGM: true },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: { warn: () => undefined, error: () => undefined, info: () => undefined },
};
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: { wait: async () => null, input: async () => null },
		},
		handlebars: { renderTemplate: async () => "<div>card</div>" },
	},
	utils: { fromUuidSync: () => null },
};

const { fearHandler } = await import("./fear");
const { SHOCK_TABLE } = await import("../../rules/fear");
const { foundryPorts, resetPorts, setPorts } = await import(
	"../../infrastructure/foundry/ports"
);
const { shockOutcome } = await import("../../rules/fear");

type FearRequest = Parameters<NonNullable<typeof fearHandler.after>>[0];
type FearOutcome = Parameters<NonNullable<typeof fearHandler.after>>[2];

const globals = globalThis as Record<string, unknown>;

afterEach(() => resetPorts());

afterAll(() => {
	for (const key of ["game", "ui", "foundry"]) {
		if (originalGlobals[key] === undefined)
			delete globals[key];
		else globals[key] = originalGlobals[key];
	}
});

// --- Test fakes -----------------------------------------------------------

interface PostedCard {
	template: string;
	vars: Record<string, unknown>;
}

/**
 * A fake actor whose system.insanity the Actors port mutates in place, plus
 * the log of updates so a delta can be asserted directly.
 */
function fakeActor() {
	const actor = {
		uuid: "Actor.victim",
		name: "Victim",
		items: [] as unknown[],
		effects: [] as unknown[],
		system: { insanity: 0 },
	};
	const updates: Record<string, unknown>[] = [];
	const actors = {
		update: async (a: unknown, patch: Record<string, unknown>) => {
			updates.push(patch);
			// Dotted-path write, exactly what the real adapter applies.
			for (const [key, value] of Object.entries(patch)) {
				const path = key.split(".");
				let cursor = a as Record<string, unknown>;
				for (const step of path.slice(0, -1)) cursor = cursor[step] as Record<string, unknown>;
				cursor[path[path.length - 1]!] = value;
			}
		},
		createEffects: async () => undefined,
		deleteEffects: async () => undefined,
	} as unknown as Ports["actors"];
	return { actor, updates, actors };
}

/** Dice stub: answer each formula from a queue, remembering every call. */
function fakeDice(
	answers: Record<string, number[]>,
): { dice: Ports["dice"]; rolled: string[] } {
	const queue = new Map(Object.entries(answers));
	const counters: Record<string, number> = {};
	const rolled: string[] = [];
	return {
		rolled,
		dice: {
			roll: async (formula) => {
				rolled.push(formula);
				const answered = queue.get(formula);
				const idx = counters[formula] ?? 0;
				counters[formula] = idx + 1;
				const pick = answered ? (answered[idx] ?? 0) : 0;
				return {
					total: pick,
					dice: [{ result: pick, faces: pick }],
					terms: [{ class: "Die", faces: pick, results: [pick] }],
					formula,
				};
			},
		},
	};
}

/** Wire the fakes in and return the handles. */
function setup(answers: Record<string, number[]>) {
	const { actor, updates, actors } = fakeActor();
	const { dice, rolled } = fakeDice(answers);
	const posted: PostedCard[] = [];
	setPorts({
		...foundryPorts,
		dice,
		actors,
		i18n: { t: (key: string) => key } as unknown as Ports["i18n"],
		chat: {
			...foundryPorts.chat,
			post: async (_a: unknown, template: string, vars: Record<string, unknown>) => {
				posted.push({ template, vars });
				return { id: "msg-1" };
			},
		} as unknown as Ports["chat"],
	});
	return { actor, updates, rolled, posted };
}

/** Hand-built prepared payload (what fearHandler.prepare computes). */
function preparedFor(situation: "combat" | "non-combat"): PreparedRoll<"fear"> {
	return {
		title: "Victim — FEAR.TEST_TITLE",
		baseTarget: 50,
		testKind: "fear",
		testKey: "wp",
		initialModifiers: [],
		weapon: null,
		context: { flags: { fear: true } },
		handledConditionFlags: ["fear"],
		templateVars: { immune: false, situation },
		autoPassRoll: null,
		kindData: { rating: 2, situation, sourceName: "" },
	} as PreparedRoll<"fear">;
}

function failedOutcome(roll: number) {
	return {
		roll,
		success: false,
		degrees: 1 + Math.floor((roll - 50 - 1) / 10),
		margin: 0,
		isDouble: false,
		critical: false,
	};
}

describe("fearHandler.after Insanity threading (bead 3u1p: combat)", () => {
	test("card insanityGain EQUALS the delta applied to system.insanity", async () => {
		// Willpower 50, roll 91 = 5 degrees (failed by 41). Shock Table:
		// 1d100 face 30 + 10x5 = 80 -> the "1d5 Insanity" bucket (61-80).
		// The d5 queue answers 4 then 1: under the old applyCondition behaviour
		// the card got 4 and the actor gained 1 — the assert pins the SAME 4.
		const { actor, rolled, posted } = setup({
			"1d100": [30],
			"1d5": [4, 1],
		});
		await fearHandler.after!(
			{
				kind: "fear",
				actor: actor as unknown as FearRequest["actor"],
				rating: 2,
				situation: "combat",
			},
			preparedFor("combat"),
			failedOutcome(91) as FearOutcome,
			"msg-1",
		);
		// One d100 (the Shock Table) and ONE d5 — not two.
		expect(rolled.filter((f) => f === "1d5")).toHaveLength(1);
		const card = posted[0]!;
		expect(card.template).toBe(`${TEMPLATE_ROOT}chat/fear-shock.hbs`);
		expect(card.vars.insanityGain).toBe(4);
		// The SAME 4 the card reports landed on the track.
		expect(actor.system.insanity).toBe(4);
	});

	test("a Shock row with no Insanity gain leaves the track untouched", async () => {
		// 1d100 face 20, failed by 1 => 1 degree => shock total 20 + 10 = 30 ->
		// the 21-40 bucket (also "0" Insanity, conditions.ts SHOCK_INSANITY).
		const { actor, updates } = setup({ "1d100": [20] });
		await fearHandler.after!(
			{ kind: "fear", actor: actor as unknown as FearRequest["actor"], rating: 2, situation: "combat" },
			preparedFor("combat"),
			failedOutcome(51) as FearOutcome,
			"msg-1",
		);
		expect(shockOutcome(30).textKey).toBe("FEAR.SHOCK_21_40");
		expect(actor.system.insanity).toBe(0);
		expect(updates.filter((u) => u["system.insanity"] !== undefined)).toHaveLength(0);
	});
});

describe("fearHandler.after Insanity threading (bead eclw: non-combat)", () => {
	test("failed by 30+ (4 degrees) applies the card's rolled +1d5", async () => {
		// Willpower 50, roll 91 = 5 degrees = failed by 41 -> +1d5 Insanity
		// Points (Core Rulebook p296); the "unnerved" condition itself carries
		// insanity "0", so the rolled gain must be threaded explicitly.
		const { actor, rolled, posted } = setup({ "1d5": [3] });
		await fearHandler.after!(
			{ kind: "fear", actor: actor as unknown as FearRequest["actor"], rating: 2, situation: "non-combat" },
			preparedFor("non-combat"),
			failedOutcome(91) as FearOutcome,
			"msg-1",
		);
		expect(rolled).toEqual(["1d5"]);
		const card = posted[0]!;
		expect(card.vars.insanityNote).toContain("3");
		expect(actor.system.insanity).toBe(3);
	});

	test("failed by < 30 (3 degrees) leaves system.insanity unchanged", async () => {
		// Roll 79 = failed by 29 = 3 degrees -> below the 4-degree threshold,
		// so NO 1d5 is rolled at all (p296) and the track is untouched; the
		// -10 concentration note still applies. (Bead uosq: this used to use
		// roll 80 = failed by 30 = 4 degrees, where production DOES roll the
		// 1d5 — the pass was only the unqueued dice stub answering 0.)
		const { actor, updates, rolled } = setup({});
		await fearHandler.after!(
			{ kind: "fear", actor: actor as unknown as FearRequest["actor"], rating: 2, situation: "non-combat" },
			preparedFor("non-combat"),
			failedOutcome(79) as FearOutcome,
			"msg-1",
		);
		// Exactly on the boundary: 3 degrees rolls no Insanity die.
		expect(rolled).not.toContain("1d5");
		expect(actor.system.insanity).toBe(0);
		expect(updates.filter((u) => u["system.insanity"] !== undefined)).toHaveLength(0);
	});

	test("failed by exactly 30 (4 degrees) rolls and applies the +1d5 gain", async () => {
		// Roll 80 = failed by 30 = 4 degrees — exactly the book boundary
		// (p296): the 1d5 IS rolled and its non-zero result lands on the
		// track (and on the card), not silently dropped.
		const { actor, posted } = setup({ "1d5": [2] });
		await fearHandler.after!(
			{ kind: "fear", actor: actor as unknown as FearRequest["actor"], rating: 2, situation: "non-combat" },
			preparedFor("non-combat"),
			failedOutcome(80) as FearOutcome,
			"msg-1",
		);
		expect(actor.system.insanity).toBe(2);
		expect(posted[0]!.vars.insanityNote).toContain("2");
	});
});

describe("shock table sanity (index alignment)", () => {
	test("the 61-80 bucket used above is the 1d5 row", () => {
		const index = SHOCK_TABLE.indexOf(shockOutcome(80));
		expect(index).toBe(3);
	});
});