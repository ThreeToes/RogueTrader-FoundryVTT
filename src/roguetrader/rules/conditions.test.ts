import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	carriedConditions,
	conditionEffectData,
	encounterEndRemovals,
	encounterLengthStatusIds,
	isEncounterLength,
	snapOutReady,
	shockCondition,
	SYSTEM_STATUSES,
	systemStatus,
	unnervedCondition,
	STATUS_IMG,
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

describe("encounter-end mapping (bead cneb)", () => {
	test("isEncounterLength: no rounds/hours = encounter-length", () => {
		expect(isEncounterLength(shockCondition(30))).toBe(true); // shaken
		expect(isEncounterLength(shockCondition(70))).toBe(true); // frozen
		expect(isEncounterLength(unnervedCondition())).toBe(true);
		expect(isEncounterLength(shockCondition(10))).toBe(false); // 1 round
		expect(isEncounterLength(shockCondition(110))).toBe(false); // 1d5 rounds
		expect(isEncounterLength(shockCondition(170))).toBe(false); // hours
	});

	test("encounterLengthStatusIds derives from the condition table (no drift)", () => {
		const ids = encounterLengthStatusIds();
		// Every id is a real registry status.
		for (const id of ids) expect(SYSTEM_STATUSES.some((s) => s.id === id)).toBe(true);
		// The book's encounter-length outcomes: shaken/frozen/fleeing/frenzied
		// (p295) + non-combat unnerved (p296). NOT startled/unconscious/frozen's
		// timed/catatonic/hallucinating rounds-and-hours flavours.
		expect(new Set(ids)).toEqual(
			new Set(["shaken", "frozen", "fleeing", "frenzied", "unnerved"]),
		);
	});

	test("encounterEndRemovals: picks encounter-length status effects only", () => {
		const removals = encounterEndRemovals([
			{ id: "ae-shaken", statuses: ["shaken"] },
			{ id: "ae-unrelated", statuses: ["dead"] },
			{ id: "ae-timed", statuses: ["startled"] }, // non-encounter status
			{ statuses: ["fleeing"] }, // no id — nothing to delete
		]);
		expect(removals).toEqual([{ id: "ae-shaken", statusId: "shaken" }]);
	});

	test("encounterEndRemovals: a TIMED variant of an encounter status stays", () => {
		// Frozen comes in both flavours (p295); Foundry self-expires the timed
		// one, so encounter end must not delete it.
		const removals = encounterEndRemovals([
			{ id: "ae-frozen-timed", statuses: ["frozen"], duration: { rounds: 5 } },
			{ id: "ae-shaken", statuses: ["frozen", "shaken"], duration: { seconds: 0 } },
		]);
		// The second effect carries frozen (encounter-length flavour) and a
		// null seconds — still removed, both statuses reported as one removal.
		expect(removals).toEqual([{ id: "ae-shaken", statusId: "frozen" }]);
	});

	test("encounterEndRemovals: one removal per effect even with several statuses", () => {
		const removals = encounterEndRemovals([
			{ id: "ae1", statuses: ["shaken", "fleeing", "blind"] },
		]);
		expect(removals).toEqual([{ id: "ae1", statusId: "shaken" }]);
	});
});

// -------------------------------------------------------------------------
// Content guards: combat-chapter conditions (epic vr1o, bead c9nt). Every
// row carries its printed-page cite in conditions.ts source comments (the
// extraction-convention cite); ids, label keys and icon paths are verified
// as data rather than trusted by hand.
// -------------------------------------------------------------------------

/** The combat-chapter status ids this bead added + on-fire (extended). */
const COMBAT_CONDITION_IDS = [
	"prone",
	"pinned",
	"grappled",
	"helpless",
	"blinded",
	"deafened",
	"blood-loss",
	"unaware",
	"surprised",
	"on-fire",
] as const;

/**
 * The Core status ids the registry INTENTIONALLY shadows
 * (foundry.mjs default statusEffects; registerSystemStatuses REPLACES
 * CONFIG.statusEffects wholesale — p0af, bead q1ql). Any other collision
 * would be a slug accident, not a shadow.
 */
const INTENTIONAL_CORE_SHADOWS = new Set([
	"unconscious",
	"stunned",
	"frozen",
	"prone",
]);

/** Foundry CORE's default status ids (verified against foundry.mjs). */
const CORE_STATUS_IDS = new Set([
	"bleeding",
	"blind",
	"burning",
	"corrode",
	"curse",
	"dead",
	"deaf",
	"disease",
	"fear",
	"fly",
	"frozen",
	"paralysis",
	"poison",
	"prone",
	"regen",
	"restrain",
	"shock",
	"silence",
	"sleep",
	"stun",
	"unconscious",
]);

/** Core-icons install root ends at the icons/ directory (6ts8 convention). */
const CORE_ICONS_DIR =
	process.env.FOUNDRYVTT_ICONS_DIR ??
	"/home/stephen/apps/foundryvtt/public/icons";

describe("content guards: combat conditions (epic vr1o / bead c9nt)", () => {
	test("every registry id is unique and STATUS_IMG covers all of them exactly", () => {
		const ids = SYSTEM_STATUSES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(Object.keys(STATUS_IMG).sort())).toEqual(new Set(ids));
	});

	test("registry ids never collide with a Core status id except the documented shadows", () => {
		for (const id of SYSTEM_STATUSES.map((s) => s.id)) {
			if (!CORE_STATUS_IDS.has(id)) continue;
			expect(
				INTENTIONAL_CORE_SHADOWS.has(id),
				`status id '${id}' collides with a Core status id but is not a documented shadow`,
			).toBeTrue();
		}
	});

	test("every combat condition's labelKey exists in ALL FOUR languages", () => {
		for (const id of COMBAT_CONDITION_IDS) {
			const status = systemStatus(id);
			expect(status, `status '${id}' is in the registry`).not.toBeNull();
			expect(status?.labelKey).toMatch(/^STATUS\.[A-Z]/);
			for (const lang of ["en", "es", "fr", "pl"] as const) {
				const dict = JSON.parse(
					readFileSync(`lang/${lang}.json`, "utf8"),
				) as Record<string, string>;
				expect(
					dict[status!.labelKey],
					`${lang}.json has a non-empty ${status!.labelKey}`,
				).toBeTruthy();
			}
		}
	});

	test("every combat condition's STATUS_IMG icon exists on disk (core icons only)", () => {
		expect(existsSync(CORE_ICONS_DIR)).toBeTrue();
		for (const id of COMBAT_CONDITION_IDS) {
			const img = STATUS_IMG[id];
			expect(img).toBeTruthy();
			expect(img).toMatch(/^icons\/svg\/[a-z0-9-]+\.svg$/);
			const onDisk = join(CORE_ICONS_DIR, img.replace(/^icons\//, ""));
			expect(
				existsSync(onDisk),
				`icon path '${img}' for '${id}' missing on disk`,
			).toBeTrue();
		}
	});

	test(
	"every combat row carries a printed-page cite comment (extraction convention)",
	async () => {
		const source = await Bun.file(
			new URL("./conditions.ts", import.meta.url),
		).text();
		const rowMarker = '{ id: "';
		for (const id of COMBAT_CONDITION_IDS) {
			const rowAt = source.indexOf(`{ id: "${id}"`);
			expect(rowAt, `row for '${id}' exists in conditions.ts`).toBeGreaterThan(
				-1,
			);
			// The cite lives in the comment block directly above the row: from
			// the previous `{ id:` row up to this row.
			const prevRow = source.lastIndexOf(rowMarker, rowAt - 1);
			const block = source.slice(prevRow + 1, rowAt);
			expect(
				block,
				`'${id}' has a printed-page cite (p<NNN>) in its row comments`,
			).toMatch(/\bp2\d\d(\b|-)/);
		}
	});

	test("penalised combat conditions carry their book penalty (funnel-visible)", () => {
		expect(systemStatus("prone")?.testPenalty).toBe(-10); // -10 WS, p249
		expect(systemStatus("pinned")?.testPenalty).toBe(-20); // -20 BS, p248
		expect(systemStatus("blinded")?.testPenalty).toBe(-30); // -30 WS, p260
		expect(systemStatus("pinned")?.snapOut).toBe(true); // Willpower escape, p249
		// No-action conditions carry 0 (stunned convention, owner decision).
		for (const id of [
			"grappled",
			"helpless",
			"deafened",
			"blood-loss",
			"unaware",
			"surprised",
			"on-fire",
		]) {
			expect(systemStatus(id)?.testPenalty).toBe(0);
		}
	});
});