/**
 * Shared roll pipeline (epic kof0, phase 4): the two pieces every roll kind
 * goes through — dialog contributor collection and the test step itself.
 *
 * Extracted verbatim from rules/roll-system.ts. These are the last
 * Foundry-shaped parts of the pipeline (they open no dialog themselves, but
 * they localise and post the roll card), so they live in presentation.
 */

import {
	type Modifier,
	resolveTest,
	rtCore,
	sumModifiers,
	type TestOutcome,
} from "../../../rules-engine/src/index";
import type { ActorView } from "../../domain/model/actor";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import {
	collectTestModifiers,
	mergeModifiers,
	type TestKind,
} from "../../rules/funnel";
import type { PreparedRoll, RollContext } from "../../rules/roll-contract";

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
export async function runTest(
	view: ActorView,
	prepared: PreparedRoll,
	modifiers: Modifier[],
	context: RollContext,
): Promise<{ outcome: TestOutcome; messageId: string | null; target: number }> {
	const ports = getPorts();
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
	const target = Math.min(100, Math.max(1, prepared.baseTarget + totalModifier));

	const rollResult = (await ports.dice.roll("1d100")).total;

	const outcome = resolveTest({
		target,
		roll: rollResult,
		profile:
			prepared.autoFailRoll !== undefined || prepared.autoPassRoll !== undefined
				? {
						...rtCore,
						...(prepared.autoFailRoll !== undefined
							? { autoFailRoll: prepared.autoFailRoll }
							: {}),
						...(prepared.autoPassRoll !== undefined
							? { autoPassRoll: prepared.autoPassRoll }
							: {}),
					}
				: rtCore,
	});
	const outcomeLabel = outcome.success
		? `${ports.i18n.t("ROLL.SUCCESS")} (+${outcome.degrees} ${ports.i18n.t("ROLL.DEGREES")})`
		: ports.i18n.t("ROLL.FAILURE");

	const message = await postCard(
		view,
		"systems/rogue-trader/template/chat/roll.hbs",
		{
			title: prepared.title,
			target,
			totalModifier,
			analysis: collected,
			roll: rollResult,
			outcomeLabel,
			outcomeClass: outcome.success ? "success" : "failure",
			critical: outcome.critical,
			isDouble: outcome.isDouble,
			...prepared.templateVars,
		},
		prepared.flags,
	);
	return { outcome, messageId: message?.id ?? null, target };
}
