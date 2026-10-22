/**
 * Fear Test handler (bead jpbm, Core Rulebook p294-296) + the Foundry-side
 * status-condition helpers it owns (bead q1ql): a Willpower test whose
 * severity penalty (Table 10-3) rides the breakdown as a visible modifier.
 *
 * Context flag "fear" lets authored guarded effects (Resistance (Fear) +10,
 * bead czx guards) apply to fear tests only. Immunity (Fearless) forces the
 * pass via autoPassRoll and is announced on the card. Combat failure rolls
 * the Shock Table (d100 + 10 per degree of failure, p295); non-combat
 * failure posts the −10 concentration note (+1d5 IP when failed by 30+, p296).
 *
 * Extracted from rules/roll-system.ts (epic kof0, phase 4) and moved onto the
 * ports for i18n / notify / dice / actor writes.
 */

import type { DiceResult } from "../../../ffg/application/ports";
import { adjustTrack } from "../../../ffg/application/tracks";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import {
	type ConditionData,
	carriedConditions,
	conditionEffectData,
	shockCondition,
	systemStatus,
	unnervedCondition,
} from "../../rules/conditions";
import {
	degreesOfFailure,
	fearImmune,
	fearReroll,
	fearSeverityModifier,
	shockOutcome,
} from "../../rules/fear";
import { traumaRoll } from "../../rules/madness";
import type { RollHandler } from "../../rules/roll-contract";
import { runTest } from "./pipeline";

// ---------------------------------------------------------------------------
// Status conditions (bead q1ql) — Foundry-side helpers. The pure mapping
// lives in rules/conditions.ts; these touch actor documents.
// ---------------------------------------------------------------------------

/**
 * Localized condition name for chat/AE display.
 *
 * Bead lfjw: this used to read `game.i18n?.localize(key) ?? status.id`, which
 * fell back to the raw status id when i18n was absent. It now goes through the
 * I18n port, whose stated contract is "resolve a key; return the key when it
 * cannot be resolved" (the Foundry implementation does exactly that). The
 * headless output is therefore the label KEY rather than the id — deliberate,
 * and consistent with every other localisation in the roll pipeline.
 */
function conditionLabel(statusId: string): string {
	const status = systemStatus(statusId);
	return status ? getPorts().i18n.t(status.labelKey) : statusId;
}

/**
 * A rolled formula the card reports.
 *
 * Bead wvkd: the evaluated Roll rides the chat message so Dice So Nice!
 * animates the die — the total alone is enough for the rules, not for a table
 * that wants to SEE it roll.
 */
type CardRoll = DiceResult;

/** No Insanity gain: no die was rolled, so there is nothing to animate. */
const NO_INSANITY_GAIN: CardRoll = {
	total: 0,
	dice: [],
	terms: [],
	formula: "",
};

/** Roll an insanity-gain formula ("0" / "1" / "1d5" / "1d5+1" / ...). */
async function rollInsanityGain(formula: string): Promise<CardRoll> {
	if (!formula || formula === "0") return NO_INSANITY_GAIN;
	return await getPorts().dice.roll(formula);
}

/**
 * Apply a condition to the actor: replace any carried system-status effects
 * (one translucent condition at a time), create the ActiveEffect (token marker
 * + system.testModifier change via the funnel's "effect" contributor), and
 * apply the book's Insanity gain to system.insanity (visible on the card).
 *
 * `preRolledInsanity` (bead 3u1p / eclw) threads a gain the caller has ALREADY
 * rolled (the Shock card's displayed value, or the non-combat +1d5): the
 * applied amount and the card then SHOW the same die. Pass undefined to keep
 * the old roll-inside behaviour (critical-card path). Returns the gain
 * actually applied to system.insanity (0 for none).
 *
 * EXPORTED (bead ronn): the critical card's one-click Stunned suggestion
 * walks the SAME write path, so card-applied conditions and fear/shock
 * conditions cannot drift apart.
 */
export async function applyCondition(
	actor: Actor,
	condition: ConditionData,
	rollTotal: number,
	preRolledInsanity?: number,
): Promise<number> {
	const ports = getPorts();
	const carried = carriedConditions(actor)
		.map((c) => c.id)
		.filter((id) => id !== "");
	if (carried.length > 0) {
		await ports.actors.deleteEffects(actor, carried);
	}
	const data = conditionEffectData(
		condition,
		rollTotal,
		conditionLabel(condition.statusId),
	);
	if (!data) {
		console.warn(
			`rogue-trader | unknown condition status "${condition.statusId}" — not applied (bead q1ql)`,
		);
		return 0;
	}
	await ports.actors.createEffects(actor, [data]);
	const gain =
		preRolledInsanity !== undefined
			? preRolledInsanity
			: condition.insanity && condition.insanity !== "0"
				? (await rollInsanityGain(condition.insanity)).total
				: 0;
	if (gain > 0) {
		await adjustTrack(ports.actors, actor, "insanity", gain);
	}
	return gain;
}

/** Fear Test (bead jpbm, Core Rulebook p294-296). */
export const fearHandler: RollHandler<"fear"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		if (!Number.isInteger(request.rating) || request.rating < 1) {
			ports.notify.warn("FEAR.INVALID_RATING", { rating: request.rating });
			return null;
		}
		const system = systemOf(actor);
		const characteristic = system.characteristics.wp;
		if (!characteristic) {
			ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", { key: "wp" });
			return null;
		}
		// Bead 4398: these read through the effect-kind registry now, so the
		// Foundry actor is snapshotted into the read model first.
		const immune = fearImmune(actorView(actor));
		const sourceLabel = request.sourceName
			? ` — ${ports.i18n.t("FEAR.SOURCE_PREFIX")} ${request.sourceName}`
			: "";
		return {
			title: `${actor.name} — ${ports.i18n.t("FEAR.TEST_TITLE")}${sourceLabel}`,
			baseTarget: characteristic.value,
			testKind: "fear",
			testKey: "wp",
			// Severity modifier FIRST in the breakdown (visible, Table 10-3);
			// authored guarded rows join via the funnel (flag "fear" below).
			initialModifiers: [
				fearSeverityModifier(request.rating),
				...(request.modifiers ?? []),
			],
			weapon: null,
			context: { flags: { fear: true } },
			// The Fear Test sets the "fear" guard itself (Resistance etc.).
			handledConditionFlags: ["fear"],
			templateVars: {
				immune,
				situation: request.situation ?? "combat",
			},
			// Fearless et al: the roll is made but cannot fail (p294 Fearless
			// prose; immune actors act normally).
			autoPassRoll: immune ? 100 : null,
			kindData: {
				rating: request.rating,
				situation: request.situation ?? "combat",
				sourceName: request.sourceName ?? "",
			},
		};
	},
	async after(request, prepared, outcome, _messageId, info) {
		const ports = getPorts();
		// prepare() always sets kindData for a fear test; the guard is what makes
		// the payload typed instead of cast (bead ezys).
		const data = prepared.kindData;
		if (!data) return;
		const rerolled = data.rerolled ?? false;
		// Unshakeable Faith (book p108: "may re-roll failed Fear Tests"): one
		// automatic re-roll with the SAME modifier set, visibly noted; the
		// re-roll's own outcome replaces the original (no second re-roll).
		// Bead nyns: ONE view for the after-hook — the re-roll gate and the
		// rerun read the same snapshot instead of rebuilding the inventory into
		// two views inside this one call chain.
		const view = actorView(request.actor);
		if (!outcome.success && !rerolled && fearReroll(view)) {
			const reroll = await runTest(
				view,
				{
					...prepared,
					title: `${prepared.title} — ${ports.i18n.t("FEAR.REROLL_NOTE")}`,
					kindData: { ...data, rerolled: true },
				},
				info?.modifiers ?? [],
				prepared.context,
			);
			outcome.success = reroll.outcome.success;
			outcome.roll = reroll.outcome.roll;
			outcome.degrees = reroll.outcome.degrees;
		}
		if (outcome.success) return;
		const situation = data.situation;
		const finalTarget = info?.target ?? prepared.baseTarget;
		if (situation !== "combat") {
			// Non-combat failure (p296): −10 on concentration Tests while
			// nearby (carried as the "unnerved" status, bead q1ql); failed by 30
			// or more also gains +1d5 Insanity Points.
			const failedBy = degreesOfFailure(finalTarget, outcome.roll);
			const condition = unnervedCondition();
			const insanityGain =
				failedBy >= 4 ? await rollInsanityGain("1d5") : NO_INSANITY_GAIN;
			await applyCondition(
				request.actor,
				condition,
				outcome.roll,
				insanityGain.total,
			);
			await postCard(
				request.actor,
				`${TEMPLATE_ROOT}chat/fear-shock.hbs`,
				{
					title: prepared.title,
					shockText: ports.i18n.t("FEAR.NONCOMBAT_FAILURE"),
					conditionName: conditionLabel(condition.statusId),
					insanityNote:
						failedBy >= 4
							? `${ports.i18n.t("FEAR.NONCOMBAT_INSANITY")}${insanityGain.total ? ` (${insanityGain.total})` : ""}`
							: "",
				},
				undefined,
				// Bead wvkd: the +1d5 Insanity die animates.
				insanityGain.rolls,
			);
			return;
		}
		// Combat failure (p295): Shock Table, d100 + 10 per degree of failure.
		// The +10-per-degree arithmetic is ONE helper (bead 7c2n): traumaRoll is
		// the book-cited implementation (Table 10-6 — the same sentence), shared
		// instead of repeated here.
		// Bead wvkd: the evaluated roll is kept so the Shock die animates.
		const shock = await ports.dice.roll("1d100");
		const shockTotal = traumaRoll(
			degreesOfFailure(finalTarget, outcome.roll),
			shock.total,
		);
		const row = shockOutcome(shockTotal);
		// Apply the row's condition + Insanity gain (bead q1ql): statuses are
		// the Foundry-native carrier; the card shows what landed. The SAME dice
		// result is displayed and applied (bead 3u1p) via the pre-rolled gain.
		const condition = shockCondition(shockTotal);
		const insanityGain = await rollInsanityGain(condition.insanity);
		await applyCondition(
			request.actor,
			condition,
			shockTotal,
			insanityGain.total,
		);
		await postCard(
			request.actor,
			`${TEMPLATE_ROOT}chat/fear-shock.hbs`,
			{
				title: prepared.title,
				shockRoll: shockTotal,
				shockText: ports.i18n.t(row.textKey),
				conditionName: conditionLabel(condition.statusId),
				insanityGain: insanityGain.total,
			},
			undefined,
			// Bead wvkd: the Shock die animates.
			shock.rolls,
		);
	},
};
