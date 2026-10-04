/**
 * Transient conditions as Foundry statuses (bead q1ql, Core Rulebook Ch X
 * pp294-296 + combat condition conventions). PURE module: data in, Foundry
 * AE-shape data out; the adapter side (the roll handlers under
 * presentation/rolls/, e.g. rolls/fear.ts, and init) does the document
 * writes.
 *
 * Foundry paradigm mapping (owner design, epic character statuses):
 * - momentary conditions = system statuses (CONFIG.statusEffects, token
 *   markers) carried as ActiveEffects with `statuses: [id]` and a
 *   `system.testModifier` change so the EXISTING funnel "effect"
 *   contributor applies the test penalty with a visible breakdown;
 * - permanent afflictions = owned items (disorders/malignancies/mutations, epic nt8k);
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
import { readRtFlag, rtFlagPath } from "./chat-flags";

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
	// On Fire, printed p260-261 (files 0261-0262): at EACH Round start the
	// blazing character suffers 1d10 Energy damage (NO armour reduction, p261)
	// AND gains 1 level of Fatigue, until the fire is extinguished — per-round
	// damage/fatigue ticks are NOT expressible in the one-shot status change
	// channel and are recorded here for the duration-automation machinery
	// (bead u3i7). Also per Turn start: a Challenging (+0) Willpower Test to
	// act normally, else the character may only "run around and scream" (a
	// Full Action, p262). SELF-EXTINGUISH (p262): dropping Prone + a Hard
	// (−20) Agility Test as a Full Action puts the flames out (GM may adjust);
	// that is an Agility roll, not a Willpower snap-out test, so snapOut
	// stays false — the book escape route is documented, not automated.
	{ id: "on-fire", labelKey: "STATUS.ON_FIRE", icon: "fa-solid fa-fire", testPenalty: 0, snapOut: false },
	// ---------------------------------------------------------------------
	// Combat-chapter conditions (epic vr1o, verified by bead t2ak; owner
	// spot-check passed 2026-10-04). Encoding notes:
	// - system.testModifier is a single victim-side value applied to ALL
	//   tests. Where the book prints a victim penalty we carry the closest
	//   single number; attacker-side bonuses and per-round/auto-fail
	//   categories are NOT expressible in this channel and are recorded
	//   below as book rules for future effect-kind machinery.
	// - "Can take no Actions" conditions carry testPenalty 0 (matching
	//   stunned, kept at 0 by owner decision): the victim cannot act at all,
	//   and the attacker-side hit bonuses are the book's real penalty.
	// ---------------------------------------------------------------------
	// Prone, printed p249 (file 0250; the ToC/Index "p248" is the book's own
	// index error - confirmed against the body footer, bead t2ak spot-check):
	// victim -10 WS / -20 Dodge; attacker-side +10 WS (Ordinary) / -10 BS
	// (Difficult, waived at Point Blank) vs prone targets - attacker-side,
	// not victim-testPenalty, so only the -10 WS number rides the funnel
	// (the Dodge -20 and attacker modifiers recorded, not automated).
	// Duration: static until Stands. Dropping Prone is a Free Action unless
	// engaged in a Grapple (p249); Knock-Down (p242) applies it on success.
	{ id: "prone", labelKey: "STATUS.PRONE", icon: "fa-solid fa-person-falling", testPenalty: -10, snapOut: false },
	// Pinned, printed p248-249 (files 0249-0250): Half Actions only; -20 to
	// all Ballistic Skill Tests; may not leave cover except to retreat.
	// The -20 BS number rides the funnel; the action economy is not
	// expressible in the test channel. Escape: a Willpower Test at the end
	// of the victim's Turn (Easy +30 when no longer under fire, melee
	// auto-escapes, p249) -> snapOut true. Applied by a failed Hard (-20)
	// Willpower Pinning Test against suppressive fire (p248).
	{ id: "pinned", labelKey: "STATUS.PINNED", icon: "fa-solid fa-crosshairs", testPenalty: -20, snapOut: true },
	// Grappled, printed p246-247 (files 0247-0248): grapple participants
	// cannot use Reactions, may only use the Grapple Action, count as
	// engaged in melee, and other attackers gain +20 WS to hit them
	// (attacker-side, not automated). No victim test penalty is printed;
	// the funnel value is 0. Escape: Break Free = Opposed Strength Test
	// (p247), not a Willpower snap-out -> snapOut false. The controller can
	// end the Grapple as a Free Action; larger grapplers count extra
	// degrees of success per size difference (p242).
	{ id: "grappled", labelKey: "STATUS.GRAPPLED", icon: "fa-solid fa-link", testPenalty: 0, snapOut: false },
	// Helpless, printed p248 (file 0249; Status Conditions overview p241): a
	// Helpless character can take no Actions and is no longer Helpless at
	// the GM's discretion (waking up, breaking free, etc.). Helpless
	// Targets (p248): WS Tests to hit auto-succeed and damage is rolled
	// twice (both dice added) - the auto-hit is the "real" penalty and the
	// victim rolls no defence anyway, so testPenalty 0 (stunned convention).
	{ id: "helpless", labelKey: "STATUS.HELPLESS", icon: "fa-solid fa-user-slash", testPenalty: 0, snapOut: false },
	// Blinded, printed p260 (file 0261): auto-fail ALL vision-based tests
	// and ALL Ballistic Skill Tests; -30 WS and most other tests that
	// benefit from vision. The -30 rides the funnel; the auto-fail
	// categories (vision tests, BS) are recorded, not automated.
	{ id: "blinded", labelKey: "STATUS.BLINDED", icon: "fa-solid fa-eye-slash", testPenalty: -30, snapOut: false },
	// Deafened, printed p260 (file 0261): cannot hear well enough to
	// communicate; auto-fails any Skill/Characteristic Test relying on
	// hearing until he recovers or the disability is repaired; the GM is
	// free to decide further effects. Auto-fail is the book mechanism, so
	// the funnel value is 0.
	{ id: "deafened", labelKey: "STATUS.DEAFENED", icon: "fa-solid fa-ear-deaf", testPenalty: 0, snapOut: false },
	// Blood Loss, printed p260 (file 0261), a Critical Effect from Critical
	// Damage: 10% chance of dying each Round unless treated; a conscious
	// sufferer may attempt a Difficult (-10) Medicae Test each Round to
	// staunch the bleeding (Very Hard -30 if also engaged in strenuous
	// activity; another character may attempt it if the victim is
	// unconscious or unwilling). The per-round death check and the
	// Medicae-only staunch test are per-round machinery, not a victim test
	// penalty -> 0, rules recorded here for future automation.
	{ id: "blood-loss", labelKey: "STATUS.BLOOD_LOSS", icon: "fa-solid fa-droplet", testPenalty: 0, snapOut: false },
	// Unaware, printed p249 (file 0250; overview p241): can take no Actions
	// and is no longer Unaware once he has been attacked (successfully or
	// otherwise). Attackers gain +30 WS AND BS to hit an Unaware target
	// (Easy, p249) - attacker-side, so testPenalty 0 (stunned convention).
	{ id: "unaware", labelKey: "STATUS.UNAWARE", icon: "fa-solid fa-low-vision", testPenalty: 0, snapOut: false },
	// Surprised, printed p235 (file 0236): a Surprised character loses his
	// Turn in the first Round (can do nothing but stand dumbfounded) and
	// attackers gain +30 WS/BS vs him; after the Surprise Round resolves
	// he recovers and all combatants re-roll Initiative - automatic end,
	// not a snap-out. Recorded duration one Round (startled precedent: a
	// 1-round "stand dumbfounded" condition carries no test penalty).
	{ id: "surprised", labelKey: "STATUS.SURPRISED", icon: "fa-solid fa-circle-question", testPenalty: 0, snapOut: false },
	// ---------------------------------------------------------------------
	// FATIGUE IS A TRACK, NOT A STATUS (Core Rulebook p250-251, files
	// 0251-0252): levels gained from attacks, Grappling and some Critical
	// Effects; ANY level causes -10 to ALL tests; a number of levels in
	// excess of the Toughness Bonus collapses the character, unconscious
	// for 10-TB minutes (levels revert to TB after waking); one level is
	// removed per quiet rest hour, all after 8 consecutive hours. There is
	// no Fatigue SystemStatus here on purpose - the Character data model
	// already carries the `fatigue` level counter (data/actor/character.ts)
	// and the TB threshold is computed in rules/derived.ts. The -10 all-test
	// penalty above any level and the collapse are candidate funnelling
	// work for a future machinery bead, NOT a one-click status.
	// ---------------------------------------------------------------------
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
	// Combat-chapter conditions (epic vr1o): Foundry CORE icons ONLY
	// (game-icons.net CC-BY, shipped in public/icons/svg/ — the 6ts8
	// constraint; NO book or third-party art). Each path is verified to
	// exist on disk by the content guard in conditions.test.ts.
	prone: "icons/svg/falling.svg",
	pinned: "icons/svg/target.svg",
	grappled: "icons/svg/net.svg",
	helpless: "icons/svg/paralysis.svg",
	blinded: "icons/svg/blind.svg",
	deafened: "icons/svg/deaf.svg",
	"blood-loss": "icons/svg/blood.svg",
	unaware: "icons/svg/light-off.svg",
	surprised: "icons/svg/daze.svg",
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
		[rtFlagPath("condition")]: {
			shockRoll: rollTotal,
			textKey: condition.textKey,
			insanity: condition.insanity,
		},
	};
	if (status.snapOut) {
		data[rtFlagPath("snapOut")] = true;
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
				flags?: Record<string, Record<string, unknown>>;
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
			// The snap-out marker is a flag under the profile namespace (bead
			// pwn0): read through the shared reader, not a hardcoded literal.
			snapOut: readRtFlag(e, "snapOut") === true,
		}));
}

/** Any carried condition the book lets end via a snap-out Willpower Test. */
export function snapOutReady(actor: unknown): boolean {
	return carriedConditions(actor).some((c) => c.snapOut);
}

// ---------------------------------------------------------------------------
// Encounter-end cleanup (bead cneb): "encounter-length conditions carry no
// expiry — removed when the GM ends the encounter or via snap-out" (header
// comment, p295-296). The duration semantics below are PURE; the document
// writes live in the adapter (presentation/combat-end.ts) behind the deleteCombat hook.
// ---------------------------------------------------------------------------

/**
 * Whether a condition's book duration is encounter-length (no rounds, no
 * hours — p295-296): such conditions carry no expiry and persist until the
 * encounter ends, a snap-out ends them, or the GM removes them by hand.
 */
export function isEncounterLength(condition: ConditionData): boolean {
	return (
		condition.duration.rounds === undefined && condition.duration.hours === undefined
	);
}

/**
 * Status ids an encounter-length condition CAN produce, derived from the
 * condition table above plus the non-combat unnerved condition — no
 * hand-maintained copy that can drift. Frozen lands in BOTH flavours
 * (encounter-length and 1d5/6 rounds), which is why encounter-end removal
 * also checks the carried effect's duration (encounterEndRemovals below).
 * NOT SOURCE OF TRUTH (bead nt34 F9): the status REGISTRY ids themselves
 * (stunned, on-fire, …) are NOT what this set reads — only the condition
 * factories feeding conditionEffectData() above are covered here. Any future
 * condition-applying machinery (criticals, fear stages, …) must add its
 * conditions to this derivation CONSCIOUSLY: a status id applied by an
 * unregistered factory silently misses encounter-end removal.
 */
const ENCOUNTER_LENGTH_STATUSES: Set<string> = new Set([
	...SHOCK_CONDITIONS.filter((row) => isEncounterLength({
		statusId: row.statusId,
		duration: row.duration,
		textKey: "",
		insanity: "0",
	})).map((row) => row.statusId),
	unnervedCondition().statusId,
]);

/** The encounter-length status ids, for logging/tests (order: table order). */
export function encounterLengthStatusIds(): string[] {
	return [...ENCOUNTER_LENGTH_STATUSES];
}

/** The ActiveEffect-shaped records the encounter-end mapping reads. */
export interface EncounterEndEffectLike {
	/** ActiveEffect id (delete key). */
	id?: string;
	/** Status ids the effect carries. */
	statuses?: string[];
	/** Foundry self-expiry window (`rounds`/`seconds` set = self-expiring). */
	duration?: { rounds?: number | null; seconds?: number | null } | null;
}

export interface EncounterEndRemoval {
	/** ActiveEffect id to delete. */
	id: string;
	/** The carried status id (logging/diagnostics). */
	statusId: string;
}

/**
 * Pure selection for the encounter-end cleanup: of the given carried
 * ActiveEffect shapes, return the ones holding an encounter-length status
 * with NO expiry window. An effect with duration.rounds / duration.seconds
 * is self-expiring (Foundry expires it when the window passes) and must NOT
 * go at encounter end (timed frozen, p295). Unmatched effects (core
 * statuses, owned-buff effects) are left alone.
 */
export function encounterEndRemovals(
	effects: EncounterEndEffectLike[],
): EncounterEndRemoval[] {
	const removals: EncounterEndRemoval[] = [];
	for (const effect of effects) {
		const id = effect.id ?? "";
		if (id === "") continue;
		const rounds = effect.duration?.rounds ?? null;
		const seconds = effect.duration?.seconds ?? null;
		if (rounds || seconds) continue; // timed variant: Foundry self-expires
		for (const statusId of effect.statuses ?? []) {
			if (ENCOUNTER_LENGTH_STATUSES.has(statusId)) {
				removals.push({ id, statusId });
				break;
			}
		}
	}
	return removals;
}