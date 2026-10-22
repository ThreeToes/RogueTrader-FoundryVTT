/**
 * The handler-agnostic roll orchestrator core (epic kof0, phase 4), extracted
 * from perform.ts (bead 1uai).
 *
 * Single roll pipeline: prepare -> dialog -> post-dialog rows -> shared test
 * (funnel -> kernel -> card) -> after. It never names a handler — the caller
 * supplies the handler for the request kind:
 *
 * - perform.ts maps RollRequest to the handler registry, so every public
 *   roll API entry point lands here;
 * - evasion.ts re-enters the pipeline directly with the skill handler, which
 *   is what breaks the old evasion -> perform -> handlers -> weapon ->
 *   evasion cycle statically (the handler registry imports weapon.ts, whose
 *   after-hook calls resolveEvasion — this module must not reach it).
 */

import { type TestOutcome } from "../../../rules-engine/index";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import { getPorts } from "../../infrastructure/foundry/ports";
import { collectConditionKeys, collectTestModifiers } from "../../rules/funnel";
import type {
	RollHandler,
	RollKind,
	RollRequest,
	TestDialogResultLike,
} from "../../rules/roll-contract";
import { TestDialog } from "../../rules/test-dialog";
import { dialogContributors, runTest } from "./pipeline";
import { conditionLabel } from "../../rules/labels";

/**
 * A neutral outcome for prepare-only kinds (bead 77r1): the shared test step
 * did not run, so after() must act on its OWN dice and never on this — it
 * exists because the handler contract types the outcome parameter.
 */
const NO_TEST_OUTCOME: TestOutcome = {
	roll: 0,
	success: false,
	degrees: 0,
	margin: 0,
	isDouble: false,
	critical: false,
};

/**
 * Run one prepared-handler roll end to end: the ownership gate, the handler's
 * prepare, the TestDialog (unless skipped), post-dialog modifiers, the shared
 * test and the handler's after-hook. Returns the test outcome (null when the
 * gate, prepare or dialog refused the roll).
 */
export async function runRoll<K extends RollKind>(
	request: Extract<RollRequest, { kind: K }>,
	handler: RollHandler<K>,
): Promise<TestOutcome | null> {
	// OWNERSHIP GATE (bead qiuo). First, before any handler runs, before the
	// dialog, and before anything is written to chat.
	//
	// It lives HERE rather than in a sheet action or the TestDialog because
	// every roll kind funnels through this function, including the two paths
	// that bypass the sheet: the chat card's second "Roll Damage" click, which
	// every user can see and press, and `skipDialog` callers, which never open
	// a dialog at all. A check anywhere else would miss one of them.
	//
	// The refusal is LOUD. A silent return would look like a broken button, and
	// silent no-ops are bugs in this repo (see the ports work, where swallowed
	// writes were made to throw).
	if (!getPorts().permissions.canRoll(request.actor)) {
		const name = (request.actor as { name?: string } | null | undefined)?.name;
		getPorts().notify.warn("ROLL.NOT_OWNER", { actor: name ?? "?" });
		return null;
	}


	// The handler's per-kind hooks take the request narrowed to the handler's
	// own kind, so each hook below is called with exactly its shape.
	const prepared = await handler.prepare(request);
	if (!prepared) return null;
	const view = actorView(request.actor);

	let dialog: TestDialogResultLike | null = null;
	let modifiers = prepared.initialModifiers;
	if (!request.skipDialog) {
		// Guarded affliction/talent conditions (bead xu83): offer a pre-roll
		// toggle for every guard that could apply to this test, and re-collect
		// the visible rows when one is switched on so the preview matches.
		//
		// Bead 4tx6: prepare-only kinds are excluded STRUCTURALLY, not by a
		// handler-maintained key list — their after-hook owns the test
		// entirely, and a toggle's collectForConditions re-collection over the
		// generic test channel would admit wildcard rows the handler's pinned
		// set never counts (the zl6e leak). Covering this with a
		// handledConditionFlags list that mirrors the handler's own scope would
		// break silently the moment either scope widens; a prepare-only kind
		// gets no generic toggles at all. (handledConditionFlags still applies
		// to ordinary kinds whose own dialog controls already own a flag.)
		const conditionScope = {
			kind: prepared.testKind,
			key: prepared.testKey,
			weapon: prepared.weapon,
			skillName: prepared.context.skillName,
		};
		const conditions = prepared.prepareOnly
			? []
			: collectConditionKeys(view, conditionScope).filter(
					(key) => !(prepared.handledConditionFlags ?? []).includes(key),
				);
		const result = await TestDialog.show({
			title: prepared.title,
			baseTarget: prepared.baseTarget,
			contributors: dialogContributors(
				view,
				prepared.testKind,
				prepared.testKey,
				modifiers,
				prepared.weapon,
				prepared.context.skillName,
			),
			...handler.dialogConfig?.(request, prepared),
			...(conditions.length > 0
				? {
						conditions,
						conditionLabel,
						collectForConditions: (flags: Record<string, boolean>) =>
							collectTestModifiers(
								view,
								{ ...conditionScope, flags },
								modifiers,
							),
					}
				: {}),
		});
		if (result === null) return null;
		dialog = result;
		modifiers = result.modifiers;
	}

	modifiers = [
		...modifiers,
		...(handler.postDialogModifiers?.(
			request,
			prepared,
			dialog ?? {
				modifiers: [],
			},
		) ?? []),
	];

	const baseContext =
		handler.testContext?.(request, prepared, dialog) ?? prepared.context;
	// Guarded-condition flags chosen in the dialog join the funnel context for
	// every roll kind (bead xu83), not only weapon attacks.
	const context = dialog?.flags
		? { ...baseContext, flags: { ...baseContext.flags, ...dialog.flags } }
		: baseContext;

	// Prepare-only kinds (bead 77r1): the shared test step would be WRONG
	// (a d100 + a pass/fail ladder against a raw-d10 kind), so the handler's
	// after-hook owns the dice + card and runRoll returns no kernel outcome.
	if (prepared.prepareOnly) {
		await handler.after?.(request, prepared, NO_TEST_OUTCOME, null, {
			target: prepared.baseTarget,
			modifiers,
			context,
		});
		return null;
	}

	const { outcome, messageId, target } = await runTest(
		view,
		prepared,
		modifiers,
		context,
	);
	await handler.after?.(request, prepared, outcome, messageId, {
		target,
		modifiers,
		context,
	});
	// The outcome rides back to callers (bead n0tp): rollSkillOutcome forwards
	// it to rules like the battlesuit repair that must ACT on Degrees of
	// Success — the caller sees the same result the card showed.
	return outcome;
}