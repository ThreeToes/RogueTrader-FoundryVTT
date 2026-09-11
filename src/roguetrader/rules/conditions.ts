/**
 * Transient conditions as Foundry statuses (bead q1ql, Core Rulebook Ch X
 * pp294-296 + combat condition conventions). PURE module: data in, Foundry
 * AE-shape data out; the adapter side (roll-system fear handler, init) does
 * the document writes.
 *
 * Foundry paradigm mapping (owner design, epic character statuses):
 * - momentary conditions = system statuses (CONFIG.statusEffects, token
 *   markers) carried as ActiveEffects with `statuses: [id]` and a
 *   `system.testModifier` change so the EXISTING funnel "effect"
 *   contributor applies the test penalty with a visible breakdown;
 * - permanent afflictions = owned items (bead rdh1);
 * - derived ranks = render-time computation (bead 4lhz).
 *
 * Book cites (verbatim rows in lang FEAR.SHOCK_*):
 * - Table 10-4 Shock Table outcomes map to a status + optional Insanity
 *   gain (p295-296). Durations: rounds where the book says Rounds; hours
 *   where the book says hours; encounter-length conditions carry no expiry
 *   (removed when the GM ends the encounter or via snap-out).
 * - Non-combat Fear failure = "unnerved" (-10 on concentration Tests while
 *   in the vicinity, p296).
 */

import { SHOCK_TABLE, shockOutcome, type ShockRow } from "./fear";

export interface SystemStatus {
	/** Status id (CONFIG.statusEffects id + ActiveEffect `statuses` key). */
	id: string;
	/** i18n label key. */
	labelKey: string;
	/** FontAwesome icon for the token marker. */
	icon: string;
	/** system.testModifier value while the condition is active. */
	testPenalty: number;
	/** Book "snap out of it": a Willpower Test can end the condition. */
	snapOut: boolean;
}

/** The registry; init.ts seeds CONFIG.statusEffects from this. */
export const SYSTEM_STATUSES: SystemStatus[] = [
	{ id: "startled", labelKey: "STATUS.STARTLED", icon: "fa-solid fa-face-flushed", testPenalty: 0, snapOut: false },
	{ id: "shaken", labelKey: "STATUS.SHAKEN", icon: "fa-solid fa-face-dizzy", testPenalty: -10, snapOut: false },
	{ id: "unnerved", labelKey: "STATUS.UNNERVED", icon: "fa-solid fa-face-fearful", testPenalty: -10, snapOut: false },
	{ id: "frozen", labelKey: "STATUS.FROZEN", icon: "fa-solid fa-snowflake", testPenalty: -30, snapOut: false },
	{ id: "fleeing", labelKey: "STATUS.FLEEING", icon: "fa-solid fa-person-running", testPenalty: -20, snapOut: true },
	{ id: "frenzied", labelKey: "STATUS.FRENZIED", icon: "fa-solid fa-face-angry", testPenalty: 0, snapOut: true },
	{ id: "hallucinating", labelKey: "STATUS.HALLUCINATING", icon: "fa-solid fa-eye", testPenalty: 0, snapOut: false },
	{ id: "catatonic", labelKey: "STATUS.CATATONIC", icon: "fa-solid fa-bed", testPenalty: 0, snapOut: false },
	{ id: "unconscious", labelKey: "STATUS.UNCONSCIOUS", icon: "fa-solid fa-moon", testPenalty: 0, snapOut: false },
	{ id: "stunned", labelKey: "STATUS.STUNNED", icon: "fa-solid fa-star", testPenalty: 0, snapOut: true },
	{ id: "on-fire", labelKey: "STATUS.ON_FIRE", icon: "fa-solid fa-fire", testPenalty: 0, snapOut: false },
];

const STATUSES_BY_ID = new Map(SYSTEM_STATUSES.map((s) => [s.id, s]));

/**
 * Token-marker images for the HUD. Only core-shipped SVG paths that are
 * known to exist are used (stun/unconscious/sleep/eye); everything else
 * falls back to the generic aura marker rather than risking a broken image.
 */
export const STATUS_IMG: Record<string, string> = {
	startled: "icons/svg/aura.svg",
	shaken: "icons/svg/aura.svg",
	unnerved: "icons/svg/aura.svg",
	frozen: "icons/svg/aura.svg",
	fleeing: "icons/svg/aura.svg",
	frenzied: "icons/svg/aura.svg",
	hallucinating: "icons/svg/eye.svg",
	catatonic: "icons/svg/sleep.svg",
	unconscious: "icons/svg/unconscious.svg",
	stunned: "icons/svg/stun.svg",
	"on-fire": "icons/svg/aura.svg",
};

export function systemStatus(id: string): SystemStatus | null {
	return STATUSES_BY_ID.get(id) ?? null;
}

/**
 * Insanity gain formulas per Shock row (p295-296). Index-aligned with
 * fear.SHOCK_TABLE rows. "0" = no gain.
 */
const SHOCK_INSANITY = [
	"0", // 01-20 badly startled
	"0", // 21-40 fear grips (snap out)
	"1", // 41-60 reeling
	"1d5", // 61-80 frozen
	"1d5", // 81-100 panic/flee
	"1d5", // 101-120 faint
	"1d5", // 121-130 overcome
	"1d5", // 131-140 hysterics
	"1d5+1", // 141-160 crumpled
	"1d10", // 161-170 catatonic
	"2d10", // 171+ shattered
] as const;

/** Duration semantics: rounds > 0; 0 = until the encounter ends; hours > 0. */
export interface ConditionDuration {
	rounds?: number;
	hours?: number;
}

export interface ConditionData {
	/** Status id (SYSTEM_STATUSES key). */
	statusId: string;
	duration: ConditionDuration;
	/** Book text for the chat card / AE description. */
	textKey: string;
	/** Insanity formula to roll, "0" = none. */
	insanity: string;
}

/**
 * Shock-row index -> condition. Index-aligned with fear.SHOCK_TABLE.
 * Frozen covers the book's "may do nothing" rows; the -30 test penalty is
 * the mechanical stand-in for "no Actions" (funnel-visible), while the full
 * action-restriction text rides the status marker tooltip.
 */
const SHOCK_CONDITIONS: Array<{
	statusId: string;
	duration: ConditionDuration;
}> = [
	{ statusId: "startled", duration: { rounds: 1 } },
	{ statusId: "shaken", duration: {} },
	{ statusId: "shaken", duration: {} },
	{ statusId: "frozen", duration: {} },
	{ statusId: "fleeing", duration: {} },
	{ statusId: "unconscious", duration: { rounds: 5 } },
	{ statusId: "frozen", duration: { rounds: 5 } },
	{ statusId: "frenzied", duration: {} },
	{ statusId: "frozen", duration: { rounds: 6 } },
	{ statusId: "catatonic", duration: { hours: 5 } },
	{ statusId: "hallucinating", duration: { rounds: 20 } },
];

/**
 * The condition resulting from a Shock Table total (d100 + 10 per degree of
 * failure). Direct lookup: the row index drives both the status mapping and
 * the Insanity formula (index-aligned with SHOCK_TABLE).
 */
/** Shared condition builder: one shape, every condition source funnels here. */
function makeCondition(
	statusId: string,
	textKey: string,
	insanity: string,
	duration: ConditionDuration,
): ConditionData {
	return { statusId, duration, textKey, insanity };
}

export function shockCondition(shockTotal: number): ConditionData {
	const row: ShockRow = shockOutcome(shockTotal);
	const index = SHOCK_TABLE.indexOf(row);
	const mapped =
		SHOCK_CONDITIONS[index] ?? SHOCK_CONDITIONS[SHOCK_CONDITIONS.length - 1];
	return makeCondition(
		mapped.statusId,
		row.textKey,
		SHOCK_INSANITY[index] ?? "0",
		mapped.duration,
	);
}

/** Non-combat Fear failure condition (p296): built over the shared maker. */
export function unnervedCondition(): ConditionData {
	return makeCondition(
		"unnerved",
		"FEAR.NONCOMBAT_FAILURE",
		"0",
		{},
	);
}

/**
 * ActiveEffect create-data shape for one condition. `label` is the LOCALIZED
 * status name (caller side: game.i18n.localize(status.labelKey)) — this
 * module stays pure (no Foundry globals), so without a label the status id
 * is used verbatim.
 */
export function conditionEffectData(
	condition: ConditionData,
	rollTotal: number,
	label?: string,
): Record<string, unknown> | null {
	const status = systemStatus(condition.statusId);
	if (!status) return null;
	const data: Record<string, unknown> = {
		name: label ?? status.id,
		img: "icons/svg/aura.svg",
		statuses: [status.id],
		"flags.rogue-trader.condition": {
			shockRoll: rollTotal,
			textKey: condition.textKey,
			insanity: condition.insanity,
		},
	};
	if (status.snapOut) {
		data["flags.rogue-trader.snapOut"] = true;
	}
	if (condition.duration.rounds) {
		data.duration = { rounds: condition.duration.rounds };
	} else if (condition.duration.hours) {
		data.duration = { seconds: condition.duration.hours * 3600 };
	}
	if (status.testPenalty !== 0) {
		data.changes = [
			{
				key: "system.testModifier",
				mode: 2, // CONST.ACTIVE_EFFECT_MODES.ADD
				value: status.testPenalty,
			},
		];
	}
	return data;
}

/**
 * Owned-condition AE names already carried by the actor (pure check for the
 * sheet "Snap Out of It" affordance and pre-apply cleanup).
 */
export function carriedConditions(
	actor: unknown,
): Array<{ id: string; name: string; snapOut: boolean }> {
	const effects = (
		actor as {
			items?: never;
			effects?: Array<{
				id?: string;
				name?: string;
				statuses?: string[];
				flags?: { "rogue-trader"?: { snapOut?: boolean } };
			}>;
		}
	).effects ?? [];
	return effects
		.filter(
			(e) =>
				Array.isArray(e.statuses) &&
				e.statuses.some((s) => systemStatus(s) !== null),
		)
		.map((e) => ({
			id: e.id ?? "",
			name: e.name ?? "",
			snapOut: e.flags?.["rogue-trader"]?.snapOut === true,
		}));
}

/** Any carried condition the book lets end via a snap-out Willpower Test. */
export function snapOutReady(actor: unknown): boolean {
	return carriedConditions(actor).some((c) => c.snapOut);
}