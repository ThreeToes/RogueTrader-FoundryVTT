/**
 * Shared roll pipeline (epic kof0, phase 4; hoisted in bead p7jv) — the two
 * pieces every roll kind goes through: dialog contributor collection and the
 * test step itself.
 *
 * PLACEMENT (bead p7jv): this moved out of
 * roguetrader/presentation/rolls/pipeline.ts so a sibling 40k system reuses
 * it. Nothing here names Rogue Trader: the roll-card template path is profile
 * DATA (`SystemProfile.rollCardTemplate`, resolved through the config port)
 * and the card flags are the namespaced `MessageFlags` shape — the RT shim at
 * roguetrader/presentation/rolls/pipeline.ts keeps the established import
 * path and the RT-flavoured `PreparedRoll` overload.
 *
 * The RT roll flows (fear, psychic, navigator, ship, weapon, evasion,
 * characteristic-skill, perform, roll-system, pack-less) STAY in
 * roguetrader — they are RT rules, not hoist candidates.
 *
 * Foundry-free per the architecture boundary: this layer imports kernel
 * (rules-engine), domain and application, plus the infrastructure ports as
 * the presentation seam that implements them.
 */

import {
	type Modifier,
	resolveTest,
	sumModifiers,
	type TestOutcome,
} from "../../../rules-engine/index";
import type { ActorView } from "../../domain/model/actor";
import { postCard } from "../../application/chat-flags";
import {
	collectTestModifiers,
	mergeModifiers,
	type TestKind,
} from "../../application/funnel";
import type {
	PreparedRoll,
	RollContext,
} from "../../application/roll-contract";
import { getPorts, localizeLabel } from "../../infrastructure/foundry/ports";

/**
 * Shared roll-card outcome label (bead s1lv, reused by bead obbp): one
 * interpolated i18n key per outcome — ROLL.SUCCESS_WITH_DEGREES with
 * {degrees} on success, ROLL.FAILURE otherwise — so other languages control
 * the sentence shape. Every roll-card outcome label (the pipeline's inline
 * card, the action handler's result card) renders through here; hand-built
 * concatenation elsewhere is a drift bug.
 */
export function outcomeLabel(success: boolean, degrees: number): string {
	const i18n = getPorts().i18n;
	return success
		? i18n.t("ROLL.SUCCESS_WITH_DEGREES", { degrees })
		: i18n.t("ROLL.FAILURE");
}

/**
 * Dialog contributors = caller modifiers + a funnel collection for the test
 * context, so talent/gear/item effects are visible (and editable-previewed)
 * in the dialog, not only on the chat card. Attack-context-dependent
 * contributors (fire-mode, condition flags) are chosen inside the dialog and
 * stay post-dialog only - the card shows the full breakdown. Ids survive the
 * dialog round-trip, so the test step's funnel merge dedupes instead of
 * doubling.
 */
export function dialogContributors(
	view: ActorView,
	kind: TestKind,
	key: string,
	modifiers: Modifier[],
	weapon: { type: string; special?: string[] } | null = null,
	skillName?: string,
): Modifier[] {
	return mergeModifiers(
		modifiers,
		collectTestModifiers(view, { kind, key, weapon, skillName }),
	);
}

/**
 * Shared test step: funnel collection -> clamped target -> 1d100 -> kernel
 * resolveTest -> roll card. Used by every kind.
 */
export async function runTest<
	K extends string,
	KindDataMap extends Record<K, unknown>,
>(
	view: ActorView,
	prepared: PreparedRoll<K, KindDataMap>,
	modifiers: Modifier[],
	context: RollContext,
): Promise<{ outcome: TestOutcome; messageId: string | null; target: number }> {
	const ports = getPorts();
	// Bead yojf: the kernel profile resolves through ports.config.profile()
	// instead of a direct rtCore import, so a sibling module swaps one binding.
	const ruleProfile = ports.config.profile();
	const collected = collectTestModifiers(
		view,
		{
			kind: prepared.testKind,
			key: prepared.testKey,
			weapon: prepared.weapon,
			...context,
		},
		modifiers,
	);
	const totalModifier = sumModifiers(collected);
	const target = Math.min(
		100,
		Math.max(1, prepared.baseTarget + totalModifier),
	);

	// Bead wvkd: the whole DiceResult is kept, not just its total — the
	// evaluated Roll rides the card so the message is roll-type and Dice So Nice!
	// animates the die (the primitives still drive the card's numbers).
	const rolled = await ports.dice.roll("1d100");
	const rollResult = rolled.total;

	const outcome = resolveTest({
		target,
		roll: rollResult,
		profile:
			prepared.autoFailRoll !== undefined || prepared.autoPassRoll !== undefined
				? {
						...ruleProfile,
						...(prepared.autoFailRoll !== undefined
							? { autoFailRoll: prepared.autoFailRoll }
							: {}),
						...(prepared.autoPassRoll !== undefined
							? { autoPassRoll: prepared.autoPassRoll }
							: {}),
					}
				: ruleProfile,
	});
	// Bead s1lv: one interpolated i18n key per outcome — the literal
	// "(+N degrees)" scaffolding is data (all four lang files carry
	// ROLL.SUCCESS_WITH_DEGREES), never English word order baked into code.
	const cardOutcomeLabel = outcomeLabel(outcome.success, outcome.degrees);

	// Bead w9sa.8: the card template is system BRANDING and the widened
	// config port makes branding OPTIONAL, so a system that has not named a
	// template yet refuses to post rather than rendering an unresolved path.
	const template = ruleProfile.rollCardTemplate;
	if (typeof template !== "string" || template === "") {
		throw new Error(
			`rollCardTemplate — the active profile (${ruleProfile.id}) carries no rollCardTemplate, so the roll card cannot be rendered; the system must brand its profile (SystemBranding, src/ffg/domain/system-profile.ts)`,
		);
	}
	const message = await postCard(
		ports,
		view,
		// The card template is system branding (bead p7jv): profile DATA, not a
		// hardcoded RT path — a sibling system points rollCardTemplate at its own.
		template,
		{
			title: prepared.title,
			target,
			totalModifier,
			// Bead dfdv: KEY-shaped labels (funnel quality keys, "ROLL.UNTRAINED"
			// ...) localize here so a non-en client never renders a raw slug/key
			// on the card; already-localized text passes through.
			analysis: collected.map((mod) => ({
				...mod,
				label: localizeLabel(mod.label),
			})),
			roll: rollResult,
			outcomeLabel: cardOutcomeLabel,
			outcomeClass: outcome.success ? "success" : "failure",
			critical: outcome.critical,
			isDouble: outcome.isDouble,
			...prepared.templateVars,
		},
		prepared.flags,
		rolled.rolls,
	);
	return { outcome, messageId: message?.id ?? null, target };
}
