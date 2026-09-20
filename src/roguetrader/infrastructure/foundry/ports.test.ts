import { afterEach, describe, expect, test } from "bun:test";
import { NO_CONTENT } from "../../application/ports";
import { currentRound, resolveCritical } from "../../rules/criticals";
import { foundryPorts, getPorts, resetPorts, setPorts } from "./ports";

// The ports (epic kof0, phase 3) are the seam that lets the rules run with no
// Foundry at all: a test swaps in fakes, the rules behave identically.

const stubActor = {
	uuid: "Actor.test",
	items: [],
	system: { criticals: {}, criticalEffects: [] },
};

afterEach(() => resetPorts());

describe("ports (epic kof0, phase 3)", () => {
	test("getPorts defaults to the Foundry set", () => {
		expect(getPorts()).toBe(foundryPorts);
	});

	test("dice can be faked so the critical flow runs headlessly", async () => {
		const rolled: string[] = [];
		setPorts({
			...foundryPorts,
			dice: {
				roll: async (formula) => {
					rolled.push(formula);
					return {
						total: 3,
						dice: [{ result: 3, faces: 10 }],
						terms: [{ class: "Die", faces: 10, results: [3] }],
						formula,
					};
				},
			},
			content: {
				capabilities: () => ({ ...NO_CONTENT, criticalTables: true }),
				documents: async () => [],
				find: async () => ({
					name: "Impact Critical Effects",
					formula: "1d5",
					results: [{ text: "Gut wound", range: [1, 5] }],
				}),
			},
		});
		// No injected tableRoll: the flow must go through the fake dice.
		const outcome = await resolveCritical({
			actor: stubActor,
			damageType: "Impact",
			location: "body",
			excess: 5,
		});
		expect(rolled).toContain("1d5");
		expect(outcome.effects[0]?.roll).toBe(3);
		expect(outcome.effects[0]?.text).toBe("Gut wound");
	});

	test("clock can be faked", () => {
		setPorts({ ...foundryPorts, clock: { round: () => 7 } });
		expect(currentRound()).toBe(7);
	});

	test("resetPorts restores the Foundry default", () => {
		setPorts({ ...foundryPorts, clock: { round: () => 7 } });
		resetPorts();
		expect(getPorts()).toBe(foundryPorts);
	});
});

// A dropped write is a bug, not a no-op: the caller goes on to post a card
// claiming the effect landed, so the user is told something untrue and nothing
// surfaces it. These pin the loud-failure contract (bead c9s3).
describe("ports fail loudly rather than dropping writes (bead c9s3)", () => {
	test("actors.update throws when the document cannot be written", async () => {
		await expect(foundryPorts.actors.update(null, {})).rejects.toThrow(
			/actors\.update — document is missing/,
		);
		await expect(foundryPorts.actors.update({}, {})).rejects.toThrow(
			/actors\.update/,
		);
	});

	test("actors.createEffects / deleteEffects throw likewise", async () => {
		await expect(foundryPorts.actors.createEffects(null, [])).rejects.toThrow(
			/createEffects/,
		);
		await expect(
			foundryPorts.actors.deleteEffects({}, ["effect-1"]),
		).rejects.toThrow(/deleteEffects/);
	});

	test("a writable document still goes through", async () => {
		const writes: object[] = [];
		const actor = {
			async update(patch: object) {
				writes.push(patch);
			},
		};
		await foundryPorts.actors.update(actor, { "system.insanity": 3 });
		expect(writes).toEqual([{ "system.insanity": 3 }]);
	});

	test("chat.update throws when the message is gone", async () => {
		// A vanished message used to swallow the amendment silently, which is
		// how the to-hit card lost its Roll Damage button with no error.
		const saved = (globalThis as Record<string, unknown>).foundry;
		(globalThis as Record<string, unknown>).foundry = {
			documents: { ChatMessage: { get: () => undefined } },
		};
		try {
			await expect(foundryPorts.chat.update("msg-1", {})).rejects.toThrow(
				/ChatMessage "msg-1" was not found/,
			);
		} finally {
			(globalThis as Record<string, unknown>).foundry = saved;
		}
	});

	test("dice.roll explains an absent Foundry instead of throwing a bare ReferenceError", async () => {
		if (typeof (globalThis as Record<string, unknown>).foundry !== "undefined") {
			return; // another suite in this process stubbed Foundry
		}
		await expect(foundryPorts.dice.roll("1d100")).rejects.toThrow(
			/Foundry is not available/,
		);
	});
});
