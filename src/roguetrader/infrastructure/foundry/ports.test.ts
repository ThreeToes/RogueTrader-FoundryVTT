import { afterEach, describe, expect, test } from "bun:test";
import {
	type Clock,
	type ConfigPort,
	type ContentPort,
	type Dice,
} from "../../../ffg/application/ports";
import { rtCore } from "../../../ffg/domain/system-profile";
import { currentRound, resolveCritical } from "../../rules/criticals";
import {
	foundryPorts,
	getPorts,
	KEY_SHAPE,
	localizeLabel,
	resetPorts,
	setPorts,
} from "./ports";

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
		const dice: Dice = {
			roll: async (formula) => {
				rolled.push(formula);
				return {
					total: 3,
					dice: [{ result: 3, faces: 10 }],
					terms: [{ class: "Die", faces: 10, results: [3] }],
					formula,
				};
			},
		};
		const content: ContentPort = {
			documents: async () => [],
			documentsOrNull: async () => [],
			find: async () => ({
				name: "Impact Critical Effects",
				formula: "1d5",
				results: [{ text: "Gut wound", range: [1, 5] }],
			}),
			document: async () => null,
		};
		// Bead x4ly: the caller-bound ports go in via the parameters, no
		// setPorts swap needed for the critical flow itself.
		const config: ConfigPort = {
			homebrew: () => null,
			profile: () => rtCore,
			originTraits: () => [],
			packIds: () => ({ rolltables: null }),
		};
		const clock: Clock = { round: () => 0 };
		// No injected tableRoll: the flow must go through the fake dice.
		const outcome = await resolveCritical({
			actor: stubActor,
			damageType: "Impact",
			location: "body",
			excess: 5,
			content,
			config,
			dice,
			clock,
		});
		expect(rolled).toContain("1d5");
		expect(outcome.effects[0]?.roll).toBe(3);
		expect(outcome.effects[0]?.text).toBe("Gut wound");
	});

	test("clock can be faked", () => {
		// Bead x4ly: `currentRound` takes its clock as a parameter now.
		const clock: Clock = { round: () => 7 };
		expect(currentRound(clock)).toBe(7);
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
		if (
			typeof (globalThis as Record<string, unknown>).foundry !== "undefined"
		) {
			return; // another suite in this process stubbed Foundry
		}
		await expect(foundryPorts.dice.roll("1d100")).rejects.toThrow(
			/Foundry is not available/,
		);
	});
});

// The display seams (TestDialog contributor rows, runTest card analysis)
// pass every modifier label through localizeLabel: KEY-shaped labels resolve
// through i18n, free text is untouched. Bead dfdv.
describe("localizeLabel (bead dfdv)", () => {
	const withFakeI18n = (
		dict: Record<string, string>,
		body: () => void,
	): void => {
		const saved = (globalThis as Record<string, unknown>).game;
		(globalThis as Record<string, unknown>).game = {
			i18n: { localize: (key: string) => dict[key] ?? `untranslated: ${key}` },
		};
		try {
			body();
		} finally {
			if (saved === undefined)
				delete (globalThis as Record<string, unknown>).game;
			else (globalThis as Record<string, unknown>).game = saved;
		}
	};

	test("KEY-shaped labels resolve through i18n (non-en dictionary)", () => {
		withFakeI18n(
			{
				"QUALITY.ACCURATE": "Precisa",
				"ROLL.AIM_HALF": "Apuntar (media acción)",
			},
			() => {
				expect(localizeLabel("QUALITY.ACCURATE")).toBe("Precisa");
				expect(localizeLabel("ROLL.AIM_HALF")).toBe("Apuntar (media acción)");
			},
		);
	});

	test("free text (names, custom rows, localized labels) passes through untouched", () => {
		withFakeI18n({}, () => {
			expect(localizeLabel("Lasgun")).toBe("Lasgun");
			expect(localizeLabel("Aim (Half)")).toBe("Aim (Half)");
			expect(localizeLabel("—")).toBe("—");
		});
	});

	test("KEY_SHAPE matches dotted UPPER_SNAKE keys only", () => {
		expect(KEY_SHAPE.test("ROLL.AIM_HALF")).toBe(true);
		expect(KEY_SHAPE.test("QUALITY.GYRO_STABILISED")).toBe(true);
		expect(KEY_SHAPE.test("CUSTOM")).toBe(false);
		expect(KEY_SHAPE.test("TYPES.Item.weapon")).toBe(false);
		expect(KEY_SHAPE.test("Accurate")).toBe(false);
	});

	test("headless (no game.i18n): a key passes through unchanged", () => {
		if ((globalThis as Record<string, unknown>).game !== undefined) {
			return; // another suite in this process stubbed game
		}
		expect(localizeLabel("QUALITY.ACCURATE")).toBe("QUALITY.ACCURATE");
	});
});
