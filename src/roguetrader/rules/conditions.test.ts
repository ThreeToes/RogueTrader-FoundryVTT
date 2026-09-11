import { describe, expect, test } from "bun:test";
import {
	carriedConditions,
	conditionEffectData,
	snapOutReady,
	shockCondition,
	SYSTEM_STATUSES,
	systemStatus,
	unnervedCondition,
} from "./conditions";
import { SHOCK_TABLE, shockOutcome } from "./fear";

describe("SYSTEM_STATUSES registry", () => {
	test("ids are unique and every status has a label key + icon", () => {
		const ids = SYSTEM_STATUSES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const s of SYSTEM_STATUSES) {
			expect(s.labelKey).toMatch(/^STATUS\./);
			expect(s.icon.length).toBeGreaterThan(0);
			expect(s.testPenalty).toBeLessThanOrEqual(0);
		}
	});

	test("systemStatus lookup and unknown ids", () => {
		expect(systemStatus("shaken")?.testPenalty).toBe(-10);
		expect(systemStatus("fleeing")?.snapOut).toBe(true);
		expect(systemStatus("nonexistent")).toBeNull();
	});
});

describe("shockCondition (Table 10-4 -> conditions)", () => {
	test("row-aligned mapping: status, duration, insanity", () => {
		// 01-20 badly startled: one round, no penalty, no insanity.
		expect(shockCondition(10)).toEqual({
			statusId: "startled",
			duration: { rounds: 1 },
			textKey: "FEAR.SHOCK_01_20",
			insanity: "0",
		});
		// 21-40 shaken for the encounter, snap-out.
		expect(shockCondition(30).statusId).toBe("shaken");
		expect(shockCondition(30).duration).toEqual({});
		// 61-80 frozen (no actions) + 1d5 insanity.
		expect(shockCondition(70)).toEqual({
			statusId: "frozen",
			duration: {},
			textKey: "FEAR.SHOCK_61_80",
			insanity: "1d5",
		});
		// 81-100 fleeing.
		expect(shockCondition(90).statusId).toBe("fleeing");
		// 101-120 unconscious 1d5 rounds (capped duration).
		expect(shockCondition(110)).toEqual({
			statusId: "unconscious",
			duration: { rounds: 5 },
			textKey: "FEAR.SHOCK_101_120",
			insanity: "1d5",
		});
		// 141-160 crumpled 1d5+1 rounds (max 6).
		expect(shockCondition(150).duration).toEqual({ rounds: 6 });
		// 161-170 catatonic 1d5 HOURS.
		expect(shockCondition(165)).toEqual({
			statusId: "catatonic",
			duration: { hours: 5 },
			textKey: "FEAR.SHOCK_161_170",
			insanity: "1d10",
		});
		// 171+ hallucinations 2d10 rounds (max 20) + 2d10 insanity.
		expect(shockCondition(200)).toEqual({
			statusId: "hallucinating",
			duration: { rounds: 20 },
			textKey: "FEAR.SHOCK_171_PLUS",
			insanity: "2d10",
		});
	});

	test("every SHOCK_TABLE row has a condition and insanity entry", () => {
		for (const row of SHOCK_TABLE) {
			const total = row.after; // bucket's lower bound
			const condition = shockCondition(total);
			expect(systemStatus(condition.statusId)).not.toBeNull();
			expect(condition.textKey).toBe(row.textKey);
			expect(condition.insanity).toMatch(/^(0|1|1d5(\+1)?|1d10|2d10)$/);
		}
	});

	test("every shock row index is covered by the mapping table", () => {
		for (const row of SHOCK_TABLE) {
			expect(shockOutcome(row.after).textKey).toBe(row.textKey);
		}
	});
});

describe("conditionEffectData", () => {
	test("statuses + snap-out flag + duration rounds", () => {
		const data = conditionEffectData(shockCondition(90), 90) as Record<
			string,
			unknown
		>;
		expect(data.statuses).toEqual(["fleeing"]);
		expect(data["flags.rogue-trader.snapOut"]).toBe(true);
		expect(data["flags.rogue-trader.condition"]).toEqual({
			shockRoll: 90,
			textKey: "FEAR.SHOCK_81_100",
			insanity: "1d5",
		});
		expect(data.duration).toBeUndefined(); // encounter-length
	});

	test("test-penalty statuses carry a system.testModifier change (funnel)", () => {
		const shaken = conditionEffectData(shockCondition(30), 30) as Record<
			string,
			unknown
		>;
		expect(shaken.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -10 },
		]);
		const startled = conditionEffectData(shockCondition(10), 10) as Record<
			string,
			unknown
		>;
		expect(startled.changes).toBeUndefined();
		const frozen = conditionEffectData(shockCondition(70), 70) as Record<
			string,
			unknown
		>;
		expect(frozen.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -30 },
		]);
	});

	test("rounds and hours durations materialise on the AE", () => {
		const unconscious = conditionEffectData(shockCondition(110), 110) as {
			duration?: { rounds?: number };
		};
		expect(unconscious.duration?.rounds).toBe(5);
		const catatonic = conditionEffectData(shockCondition(165), 165) as {
			duration?: { seconds?: number };
		};
		expect(catatonic.duration?.seconds).toBe(5 * 3600);
	});

	test("null for unknown status ids (loud-ish: caller skips)", () => {
		expect(
			conditionEffectData(
				{ statusId: "nope", duration: {}, textKey: "X", insanity: "0" },
				1,
			),
		).toBeNull();
	});

	test("unnerved condition: -10, encounter-length, no insanity", () => {
		expect(unnervedCondition().statusId).toBe("unnerved");
		const data = conditionEffectData(unnervedCondition(), 0) as Record<
			string,
			unknown
		>;
		expect(data.statuses).toEqual(["unnerved"]);
		expect(data.changes).toEqual([
			{ key: "system.testModifier", mode: 2, value: -10 },
		]);
		expect(data.duration).toBeUndefined();
	});
});

describe("carriedConditions / snapOutReady", () => {
	test("reads status AEs off the actor and flags snap-out", () => {
		const actor = {
			effects: [
				{
					id: "ae1",
					name: "Fleeing",
					statuses: ["fleeing"],
					flags: { "rogue-trader": { snapOut: true } },
				},
				{
					id: "ae2",
					name: "Shaken",
					statuses: ["shaken"],
					flags: {},
				},
				{ id: "ae3", name: "Unrelated", statuses: ["blind"] },
			],
		};
		const carried = carriedConditions(actor);
		expect(carried).toHaveLength(2);
		expect(carried[0]).toEqual({ id: "ae1", name: "Fleeing", snapOut: true });
		expect(carried[1].snapOut).toBe(false);
		expect(snapOutReady(actor)).toBe(true);
	});

	test("no conditions / no snap-out-capable conditions", () => {
		expect(carriedConditions({ effects: [] })).toHaveLength(0);
		expect(snapOutReady({})).toBe(false);
		expect(
			snapOutReady({
				effects: [{ id: "x", name: "Shaken", statuses: ["shaken"], flags: {} }],
			}),
		).toBe(false);
	});
});