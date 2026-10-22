import { describe, expect, test } from "bun:test";
import {
	NO_CONTENT_PORT,
	type Clock,
	type ConfigPort,
	type ContentPort,
	type Dice,
} from "../../ffg/application/ports";
import { rtCore } from "../../ffg/domain/system-profile";
import {
	applyDamageWithCriticals,
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
 * Bead x4ly: the critical machinery's ports (content/config/dice/clock) are
 * caller-bound, so these tests thread doubles instead of relying on the
 * global port set.
 */
const clockDouble = (): Clock => ({ round: () => 0 });
const diceDouble = (): Dice => ({
	roll: async (formula: string) => ({
		total: 0,
		dice: [],
		terms: [],
		formula,
	}),
});
const configDouble = (): ConfigPort => ({
	homebrew: () => null,
	profile: () => rtCore,
	originTraits: () => [],
	packIds: () => ({ rolltables: null }),
});

/**
 * The Foundry-side helpers of the critical-damage flow (bead ks3k). The dice
 * maths is covered in src/rules-engine/criticals.test.ts; what is tested
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
		// A clock double pinned at round 0 (no combat): the module must not throw.
		expect(typeof currentRound(clockDouble())).toBe("number");
	});
});

describe("repairSkillFor (Tau Guide p31: Hard (-20) Tech-Use or Trade (Armourer))", () => {
	const skill = (name: string) => ({ id: name, type: "skill", name });

	test("prefers Tech-Use", () => {
		const actor = actorWith([skill("Trade (Armourer)"), skill("Tech-Use")]);
		expect(repairSkillFor(actor)?.name).toBe("Tech-Use");
	});

	test("falls back to a Trade item, named variant or bare", () => {
		expect(repairSkillFor(actorWith([skill("Trade (Armourer)")]))?.name).toBe(
			"Trade (Armourer)",
		);
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
			config: configDouble(),
			dice: diceDouble(),
			clock: clockDouble(),
		});
		expect(outcome.manual).toBe(true);
		expect(outcome.effects).toHaveLength(1);
		expect(outcome.effects[0]?.location).toBe("body");
		expect(outcome.effects[0]?.severity).toBeGreaterThan(0);
		expect(outcome.effects[0]?.manual).toBe(true);
		expect(outcome.effects[0]?.text).toBe("");
	});

	// A gapped table (a malformed/incomplete pack range): the roll lands in no
	// row. The critical must STILL be recorded so the location's accumulated
	// Critical Damage rises — otherwise the next critical in that location
	// computes too low a severity (bead 152z).
	const GAP_TABLE: ContentPort = {
		// Spread for the port's content-optional defaults (bead p7o5 added
		// documentsOrNull/document); the overrides below shape the table find.
		...NO_CONTENT_PORT,
		documents: async () => [],
		find: async () => ({
			name: "Impact Critical Effects",
			formula: "1d100",
			// Everything except 40-59: a roll landing in 40-59 hits the gap.
			results: [
				{ text: "Below the gap", range: [1, 39] },
				{ text: "Above the gap", range: [60, 100] },
			],
		}),
	};

	test("a gapped table still records the critical and warns", async () => {
		const actor = actorWith([]);
		const outcome = await resolveCritical({
			actor,
			damageType: "Impact",
			location: "body",
			excess: 3,
			tableRoll: 42,
			content: GAP_TABLE,
			config: configDouble(),
			dice: diceDouble(),
			clock: clockDouble(),
		});
		expect(outcome.warning).toBe("Critical Hit (Impact, Body)");
		expect(outcome.manual).toBe(true);
		expect(outcome.effects).toHaveLength(1);
		expect(outcome.effects[0]?.manual).toBe(true);
		expect(outcome.effects[0]?.severity).toBe(3);
		expect(outcome.effects[0]?.roll).toBe(42);
		expect(outcome.effects[0]?.location).toBe("body");
		expect(outcome.effects[0]?.source).toBe("core");
		expect(outcome.effects[0]?.text).toBe("");
	});

	test("applyDamageWithCriticals persists the gap-rolled critical's severity", async () => {
		const updateCalls: object[] = [];
		const actor = {
			uuid: "Actor.test",
			items: [],
			system: { criticals: {}, criticalEffects: [], wounds: { value: 5 } },
			update: async (data: object) => {
				updateCalls.push(data);
				return data;
			},
		};
		// 8 damage against 5 wounds → 5 applied, 3 excess.
		const outcome = await applyDamageWithCriticals({
			actor,
			damage: 8,
			damageType: "Impact",
			location: "body",
			tableRoll: 42,
			content: GAP_TABLE,
			config: configDouble(),
			dice: diceDouble(),
			clock: clockDouble(),
		});
		expect(outcome.warning).toBe("Critical Hit (Impact, Body)");
		expect(outcome.excess).toBe(3);
		const update = updateCalls[0] as { system?: Record<string, unknown> };
		const criticals = update.system?.criticals as Record<string, number>;
		expect(criticals.body).toBe(3);
		// and it is stored as a manual effect so the player applies it by hand
		const effects = update.system?.criticalEffects as Array<{ manual?: boolean }>;
		expect(effects).toHaveLength(1);
		expect(effects[0]?.manual).toBe(true);
	});

	test("with content installed the table text is used", async () => {
		const content: ContentPort = {
			...NO_CONTENT_PORT,
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
			config: configDouble(),
			dice: diceDouble(),
			clock: clockDouble(),
		});
		expect(outcome.manual).toBeUndefined();
		expect(outcome.effects[0]?.text).toBe("Gut wound");
		expect(outcome.effects[0]?.manual).toBeUndefined();
	});
});
