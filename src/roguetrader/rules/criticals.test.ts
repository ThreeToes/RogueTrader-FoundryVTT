import { describe, expect, test } from "bun:test";
import {
	NO_CONTENT_PORT,
	type ContentPort,
} from "../application/ports";
import {
	criticalSheetContext,
	criticalsOf,
	currentRound,
	overrideAppliesThisTurn,
	repairSkillFor,
	resolveCritical,
	totalCriticalDamage,
	wornBattlesuit,
} from "./criticals";

/**
 * The Foundry-side helpers of the critical-damage flow (bead ks3k). The dice
 * maths is covered in src/rules-engine/src/criticals.test.ts; what is tested
 * here is the actor reading — which item counts as a worn battlesuit, when the
 * once-per-Turn override is spent, and what the sheet is handed.
 *
 * These run against plain object stubs: the module deliberately narrows the
 * actor shape it needs, so no Foundry document is required to test it.
 */
const actorWith = (items: unknown[], system: Record<string, unknown> = {}) => ({
	uuid: "Actor.test",
	items,
	system: { criticals: {}, criticalEffects: [], ...system },
});

describe("wornBattlesuit", () => {
	test("finds a WORN battlesuit", () => {
		const actor = actorWith([
			{ type: "battlesuit", name: "XV8", system: { equipState: "worn" } },
		]);
		expect(wornBattlesuit(actor)?.name).toBe("XV8");
	});

	test("ignores a battlesuit that is merely carried or stowed", () => {
		for (const state of ["carried", "stowed", ""]) {
			const actor = actorWith([
				{ type: "battlesuit", name: "XV8", system: { equipState: state } },
			]);
			expect(wornBattlesuit(actor), state).toBeUndefined();
		}
	});

	test("ignores worn armour that is not a battlesuit", () => {
		const actor = actorWith([
			{ type: "armour", name: "Carapace", system: { equipState: "worn" } },
		]);
		expect(wornBattlesuit(actor)).toBeUndefined();
	});

	test("survives an actor with no items at all", () => {
		expect(wornBattlesuit({ system: {} })).toBeUndefined();
		expect(wornBattlesuit(null)).toBeUndefined();
	});
});

describe("overrideAppliesThisTurn (Tau Guide p31: first Critical Damage each Turn)", () => {
	test("outside combat every hit is a fresh Turn", () => {
		expect(overrideAppliesThisTurn(0, 0)).toBe(true);
		expect(overrideAppliesThisTurn(7, 0)).toBe(true);
	});

	test("in combat it is spent once the round is recorded", () => {
		expect(overrideAppliesThisTurn(0, 3)).toBe(true);
		expect(overrideAppliesThisTurn(2, 3)).toBe(true);
		expect(overrideAppliesThisTurn(3, 3)).toBe(false);
	});

	test("a new round allows it again", () => {
		expect(overrideAppliesThisTurn(3, 4)).toBe(true);
	});
});

describe("actor critical reading", () => {
	test("criticals default to empty rather than undefined", () => {
		expect(criticalsOf({ system: {} })).toEqual({});
		expect(criticalsOf(null)).toEqual({});
	});

	test("totalCriticalDamage sums every location", () => {
		const actor = { system: { criticals: { head: 3, body: 2 } } };
		expect(totalCriticalDamage(actor)).toBe(5);
	});

	test("currentRound is 0 when no combat is running", () => {
		// The Bun test environment has no `game`; the module must not throw.
		expect(typeof currentRound()).toBe("number");
	});
});

describe("repairSkillFor (Tau Guide p31: Hard (-20) Tech-Use or Trade (Armourer))", () => {
	const skill = (name: string) => ({ id: name, type: "skill", name });

	test("prefers Tech-Use", () => {
		const actor = actorWith([skill("Trade (Armourer)"), skill("Tech-Use")]);
		expect(repairSkillFor(actor)?.name).toBe("Tech-Use");
	});

	test("falls back to a Trade item, named variant or bare", () => {
		expect(
			repairSkillFor(actorWith([skill("Trade (Armourer)")]))?.name,
		).toBe("Trade (Armourer)");
		expect(repairSkillFor(actorWith([skill("Trade")]))?.name).toBe("Trade");
	});

	test("is case-insensitive, because skill items are hand-typed", () => {
		expect(repairSkillFor(actorWith([skill("tech-use")]))?.name).toBe(
			"tech-use",
		);
	});

	test("ignores non-skill items that happen to be named Trade", () => {
		const actor = actorWith([{ id: "x", type: "gear", name: "Trade" }]);
		expect(repairSkillFor(actor)).toBeUndefined();
	});

	test("returns undefined when neither skill is present", () => {
		expect(repairSkillFor(actorWith([skill("Awareness")]))).toBeUndefined();
		expect(repairSkillFor(null)).toBeUndefined();
	});
});

describe("criticalSheetContext", () => {
	test("a healthy character shows no panel", () => {
		const context = criticalSheetContext(actorWith([]));
		expect(context.any).toBe(false);
		expect(context.rows).toEqual([]);
		expect(context.effects).toEqual([]);
		expect(context.canRepair).toBe(false);
	});

	test("rows list only locations that took critical damage, with lang keys", () => {
		const actor = actorWith([], {
			criticals: { "left-arm": 4, body: 2, head: 0 },
		});
		const context = criticalSheetContext(actor);
		expect(context.any).toBe(true);
		expect(context.rows).toEqual([
			{ location: "left-arm", labelKey: "BODY_LOCATION.LEFT_ARM", severity: 4 },
			{ location: "body", labelKey: "BODY_LOCATION.BODY", severity: 2 },
		]);
	});

	test("effects carry a localisable location label", () => {
		const actor = actorWith([], {
			criticalEffects: [
				{
					id: "c1",
					location: "right-leg",
					severity: 3,
					table: "Battlesuit Critical Effects (Tau)",
					roll: 44,
					source: "battlesuit",
					text: "The strike rips into the battlesuit.",
				},
			],
		});
		const context = criticalSheetContext(actor);
		expect(context.effects[0]?.locationLabelKey).toBe(
			"BODY_LOCATION.RIGHT_LEG",
		);
	});

	test("repair needs BOTH a battlesuit effect and a worn battlesuit", () => {
		const effect = {
			id: "c1",
			location: "body",
			severity: 2,
			table: "Battlesuit Critical Effects (Tau)",
			roll: 20,
			source: "battlesuit",
			text: "shredding the armour",
		};
		const noSuit = criticalSheetContext(
			actorWith([], { criticalEffects: [effect] }),
		);
		expect(noSuit.canRepair).toBe(false);

		const worn = criticalSheetContext(
			actorWith([{ type: "battlesuit", system: { equipState: "worn" } }], {
				criticalEffects: [effect],
			}),
		);
		expect(worn.canRepair).toBe(true);
	});

	test("a core critical injury is not repairable as a system fault", () => {
		const context = criticalSheetContext(
			actorWith([{ type: "battlesuit", system: { equipState: "worn" } }], {
				criticalEffects: [
					{
						id: "c2",
						location: "head",
						severity: 5,
						table: "Critical Hit (Energy, Head)",
						roll: 5,
						source: "core",
						text: "blinded permanently",
					},
				],
			}),
		);
		expect(context.canRepair).toBe(false);
		expect(context.any).toBe(true);
	});
});

// Content-optional (epic kof0, phase 3; owner requirement): with no compendium
// the critical is still recorded from the kernel's severity/location and the
// player applies the table effect manually. Installing the content only adds
// the table text.
describe("content-optional criticals (epic kof0, phase 3)", () => {
	test("with no compendium the critical is recorded and flagged manual", async () => {
		const outcome = await resolveCritical({
			actor: actorWith([]),
			damageType: "Impact",
			location: "body",
			excess: 5,
			tableRoll: 3,
			content: NO_CONTENT_PORT,
		});
		expect(outcome.manual).toBe(true);
		expect(outcome.effects).toHaveLength(1);
		expect(outcome.effects[0]?.location).toBe("body");
		expect(outcome.effects[0]?.severity).toBeGreaterThan(0);
		expect(outcome.effects[0]?.manual).toBe(true);
		expect(outcome.effects[0]?.text).toBe("");
	});

	test("with content installed the table text is used", async () => {
		const content: ContentPort = {
			capabilities: () => ({ ...NO_CONTENT_PORT.capabilities(), criticalTables: true }),
			documents: async () => [],
			find: async () => ({
				name: "Impact Critical Effects",
				formula: "1d5",
				results: [{ text: "Gut wound", range: [1, 5] }],
			}),
		};
		const outcome = await resolveCritical({
			actor: actorWith([]),
			damageType: "Impact",
			location: "body",
			excess: 5,
			tableRoll: 3,
			content,
		});
		expect(outcome.manual).toBeUndefined();
		expect(outcome.effects[0]?.text).toBe("Gut wound");
		expect(outcome.effects[0]?.manual).toBeUndefined();
	});
});
