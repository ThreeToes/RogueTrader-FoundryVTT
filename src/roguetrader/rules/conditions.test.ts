import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	carriedConditions,
	cardSuggestedCondition,
	conditionEffectData,
	encounterEndRemovals,
	encounterLengthStatusIds,
	isEncounterLength,
	snapOutReady,
	shockCondition,
	stunnedCondition,
	SYSTEM_STATUSES,
	systemStatus,
	unnervedCondition,
	STATUS_IMG,
} from "./conditions";
import type { ConditionData } from "./conditions";
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

	// Card auto-suggest (epic vr1o, bead ronn): the critical card's one-click
	// Stunned apply rides the same conditionEffectData shape.
	test("stunned condition: registry status, snap-out, no expiry, no silent modifier", () => {
		const condition = stunnedCondition();
		expect(condition.statusId).toBe("stunned");
		expect(systemStatus("stunned")).not.toBeNull();
		const data = conditionEffectData(condition, 0) as Record<string, unknown>;
		expect(data.statuses).toEqual(["stunned"]);
		expect(data["flags.rogue-trader.snapOut"]).toBe(true);
		expect(data.changes).toBeUndefined(); // testPenalty 0 (no-actions convention)
		// The printed per-row durations vary; removal is manual, no AE expiry.
		expect(data.duration).toBeUndefined();
	});

	test("cardSuggestedCondition: known ids resolve, foreign ids return null", () => {
		expect(cardSuggestedCondition("stunned")?.statusId).toBe("stunned");
		// 'poisoned' is deliberately NOT a registry status: the book's Toxic
		// failure (p117) is damage/fatigue, not a condition.
		expect(cardSuggestedCondition("poisoned")).toBeNull();
		expect(cardSuggestedCondition("nonexistent")).toBeNull();
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

// -------------------------------------------------------------------------
// Rounds duration automation (bead u3i7). VERIFICATION result, verified
// against the installed v14 core foundry.mjs: rounds-based ActiveEffect
// ticking is NATIVE core behaviour — no system tick machinery was added.
// What core does (line cites; the simulation below mirrors it faithfully):
// - Combat#onStartTurn refreshes the effect registry with "turnStart"
//   (foundry.mjs:51944), roundStart 51912, roundEnd 51882, turnEnd 51851;
// - rounds remaining are recomputed as `duration.value - (currentRound -
//   startRound)` (_prepareCombatBasedDuration, foundry.mjs:50141-50144);
// - for any non-infinite duration the expiry event defaults to "turnStart"
//   (duration schema initial, foundry.mjs:15802-15803);
// - isExpiryEvent("turnStart") only matches when the CURRENT combatant IS
//   the effect owner's combatant (foundry.mjs:50635) — ticks land on the
//   OWNING combatant's turn start;
// - refresh() deletes expired effects only when expiryAction === "delete"
//   (foundry.mjs:49545-49548 + #deleteExpiredEffects 49572) — core's
//   default is "update" (218589-218593), which merely flags duration
//   .expired; registerDurationAutomation (bootstrap/config.ts) sets
//   "delete" for the auto-removal the bead outcome asks for.
// The tests below are a headless simulation of THAT model driven by the
// real conditionEffectData() shapes — a regression guard: if core's
// semantics ever change under us (Foundry upgrade), these pin where the
// behaviour breaks.
// -------------------------------------------------------------------------

/**
 * foundry.mjs:15965-15980, verbatim semantics: a legacy `{rounds: n}` (or
 * seconds/turns) key is migrated into `{value: n, units: "rounds"}` when the
 * new-schema keys are absent.
 */
function migrateDuration(duration: Record<string, unknown>): void {
	for (const unit of ["seconds", "turns", "rounds"]) {
		const value = duration[unit];
		if (value !== undefined && typeof value === "number") {
			if (duration.value === undefined) duration.value = value;
			if (duration.units === undefined) duration.units = unit;
			break;
		}
	}
}

/** An effect shape the simulation's registry iterates (ActiveEffect subset). */
interface SimEffect {
	id: string;
	/** The condition factory product this effect was applied from. */
	condition: ConditionData;
	/** Foundry's `start` record (ActiveEffect#getEffectStart, foundry.mjs:50655). */
	start: { round?: number | null; combat: string | null };
	/** The combatant id that owns this effect (effectCombatant in 50611-50651). */
	owner: string;
	/** Set true by the simulated expiry action. */
	deleted: boolean;
}

/** Simulated combat snapshot: the inputs of a refresh(event) call. */
interface SimCombat {
	round: number;
	/** The id of the combatant whose turn is current. */
	combatant: string;
}

/**
 * One registry-refresh event, mirroring ActiveEffectRegistry#refresh
 * (foundry.mjs:49507-49550) tightened to the rounds path: remaining recompute
 * (50141-50144), turnStart owner matching (50635), delete expiry action
 * (49545-49548). Returns the ids it deleted.
 */
function refresh(
	effects: SimEffect[],
	event: "turnStart" | "roundStart" | "roundEnd" | "turnEnd",
	combat: SimCombat,
): string[] {
	const deleted: string[] = [];
	for (const effect of effects) {
		if (effect.deleted) continue;
		const raw = conditionEffectData(effect.condition, 100) as {
			duration?: Record<string, unknown>;
		} | null;
		if (!raw) continue;
		// BaseActiveEffect#migrateDuration runs on document construction, so
		// the simulation migrates the create-data shape the same way core does.
		const duration: Record<string, unknown> = { ...(raw.duration ?? {}) };
		migrateDuration(duration);
		const value = typeof duration.value === "number" ? duration.value : null;
		// _prepareCombatBasedDuration: remaining = value - (round - startRound).
		const remaining = value == null
			? Number.POSITIVE_INFINITY
			: value - (combat.round - (effect.start.round ?? 1));
		const durationReached = remaining <= 0 || !Number.isFinite(remaining);
		// isExpiryEvent: expiry defaults to "turnStart" for a numbered duration
		// (schema initial 15802-15803); encounter-length effects have neither
		// value nor expiry and can never match a combat event.
		const expiry = value != null ? "turnStart" : null;
		const isExpiryEvent = event === expiry
			&& event === "turnStart"
			&& effect.owner === combat.combatant;
		if (durationReached && isExpiryEvent) {
			effect.deleted = true; // expiryAction "delete" → #deleteExpiredEffects
			deleted.push(effect.id);
		}
	}
	return deleted;
}

// The owner's timed frozen variant: Shock 141-160 "crumpled" → frozen, 6
// rounds (p295-296). The encounter-length comparator: Shock 21-40 shaken.
const TIMED = shockCondition(150);
const ENCOUNTER = shockCondition(30);

const TURN_ORDER = ["A", "B", "C"];

/**
 * A condition applied mid-combat in the given round, owned by the combatant
 * it lands on (ActiveEffect#_preCreate stamps start from getEffectStart() —
 * foundry.mjs:49385-49393; the owning combatant is resolved from the actor,
 * foundry.mjs:50619-50633).
 */
function appliedEffect(
	id: string,
	condition: ConditionData,
	round: number,
	owner: string,
): SimEffect {
	return { id, condition, start: { round, combat: "c1" }, owner, deleted: false };
}

/** A turnStart combat snapshot against the A/B/C turn order. */
const turnStart = (round: number, turn: number): SimCombat => ({
	round,
	combatant: TURN_ORDER[turn % TURN_ORDER.length],
});

describe("rounds duration automation (bead u3i7, v14 core native)", () => {
	test("a rounds-dated condition expires on its OWNER's turn start when the rounds run out", () => {
		// frozen (crumpled, 6 rounds), applied by A in round 2.
		const effect = appliedEffect("ae-frozen", TIMED, 2, "A");
		const registry = [effect];
		// Rounds 2..7, owner A's turn start: still ticking...
		for (const round of [2, 3, 4, 5, 6, 7]) {
			expect(refresh(registry, "turnStart", turnStart(round, 0))).toEqual([]);
		}
		// Round 8, owner A's turn start: remaining 6 - (8 - 2) = 0 → deleted.
		expect(refresh(registry, "turnStart", turnStart(8, 0))).toEqual(["ae-frozen"]);
		expect(effect.deleted).toBe(true);
	});

	test("another combatant's turn start never expires a foreign effect (owner match, 50635)", () => {
		const effect = appliedEffect("ae-frozen", TIMED, 1, "B");
		const registry = [effect];
		// A's and C's turns never touch B's effect, however overdue it runs.
		for (const round of [3, 9, 15]) {
			refresh(registry, "turnStart", turnStart(round, 0)); // A
			refresh(registry, "turnStart", turnStart(round, 2)); // C
		}
		expect(effect.deleted).toBe(false);
		// Only owner B's turn start in round 7 (1 + 6) removes it.
		expect(refresh(registry, "turnStart", turnStart(7, 1))).toEqual(["ae-frozen"]);
	});

	test("encounter-length conditions are NEVER expired by core ticking — only by the deleteCombat cleanup", () => {
		const effect = appliedEffect("ae-shaken", ENCOUNTER, 2, "A");
		const registry = [effect];
		// A full 30-round encounter, every event kind, every turn slot:
		for (const event of ["turnStart", "roundStart", "roundEnd", "turnEnd"] as const) {
			for (let round = 1; round <= 30; round++) {
				for (const turn of [0, 1, 2]) {
					refresh(registry, event, { round, combatant: TURN_ORDER[turn] });
				}
			}
		}
		expect(effect.deleted).toBe(false);
		// Its removal is purely the tracker's encounter-end channel:
		expect(
			encounterEndRemovals([
				{ id: "ae-shaken", statuses: [ENCOUNTER.statusId] },
			]),
		).toEqual([{ id: "ae-shaken", statusId: "shaken" }]);
	});

	test("the timed frozen flavour survives the encounter-end cleanup (no double channel)", () => {
		expect(isEncounterLength(TIMED)).toBe(false);
		// A timed variant carries a non-null duration.rounds → encounterEndRemovals
		// (rules/conditions.ts) skips it; core's own ticking is its only removal.
		expect(
			encounterEndRemovals([
				{ id: "ae-frozen", statuses: [TIMED.statusId], duration: { rounds: 6 } },
			]),
		).toEqual([]);
	});

	test("conditionEffectData's duration shape is v14-native after migrateDuration (15965-15980)", () => {
		// Fixed-cap timed rows: frozen 1d5→6 rounds (capped, p295-296) and
		// hallucinating 20 rounds; catatonic's hours land as seconds;
		// startled is the smallest timed row, one round.
		const cases: Array<{ condition: ConditionData; value: number; units: string }> = [
			{ condition: shockCondition(10), value: 1, units: "rounds" },
			{ condition: shockCondition(150), value: 6, units: "rounds" },
			{ condition: shockCondition(160), value: 6, units: "rounds" },
			{ condition: shockCondition(170), value: 5 * 3600, units: "seconds" },
		];
		for (const { condition, value, units } of cases) {
			const data = conditionEffectData(condition, 100) as {
				duration: Record<string, unknown>;
			};
			// Migrate as core does on document construction, then assert shape.
			migrateDuration(data.duration);
			expect(data.duration.value).toBe(value);
			expect(data.duration.units).toBe(units);
		}
	});

	test("scan guard: bootstrap/config.ts wires expiryAction=delete for core's expiry path", () => {
		const source = readFileSync(
			join("src", "roguetrader", "bootstrap", "config.ts"),
			"utf8",
		);
		expect(source).toMatch(/activeEffect\.expiryAction = "delete"/);
		// And the wiring must actually be called from registerSystemConfig.
		expect(source).toMatch(/registerDurationAutomation\(\)/);
	});
});