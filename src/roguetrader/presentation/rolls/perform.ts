/**
 * The roll orchestrator and the public roll API (epic kof0, phase 4),
 * extracted from rules/roll-system.ts.
 *
 * Single roll pipeline: prepare -> dialog -> post-dialog rows -> shared test
 * (funnel -> kernel -> card) -> after. Every roll kind goes through here;
 * handlers supply the per-kind deltas. The handler registry is exhaustive
 * over RollKind, so adding a kind is a compile error until its handler
 * exists and performRoll never needs editing.
 */

import type { Actor } from "fvtt-types/documents";
import { type Modifier, type TestOutcome } from "../../../rules-engine/src/index";
import { systemOf } from "../../data/accessors";
import { actorView } from "../../infrastructure/foundry/actor-view";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import { carriedConditions, snapOutReady } from "../../rules/conditions";
import { collectConditionKeys, collectTestModifiers } from "../../rules/funnel";
import type {
	RollHandler,
	RollKind,
	RollRequest,
	TestDialogResultLike,
} from "../../rules/roll-contract";
import { shipRepairHandler, shipWeaponHandler } from "./ship";
import { TestDialog } from "../../rules/test-dialog";
import {
	characteristicHandler,
	skillHandler,
} from "./characteristic-skill";
import { fearHandler } from "./fear";
import { navigatorHandler } from "./navigator";
import { dialogContributors, runTest } from "./pipeline";
import { psychicHandler } from "./psychic";
import { weaponHandler } from "./weapon";

/**
 * The handler registry: exhaustive over RollKind. Adding a kind requires a
 * handler here (compile error otherwise) and performRoll needs no edit.
 */
export const rollHandlers: {
	[K in RollKind]: RollHandler<K>;
} = {
	characteristic: characteristicHandler,
	skill: skillHandler,
	weapon: weaponHandler,
	psychic: psychicHandler,
	navigator: navigatorHandler,
	"ship-weapon": shipWeaponHandler,
	"ship-repair": shipRepairHandler,
	fear: fearHandler,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function performRoll(request: RollRequest): Promise<void> {
	// The registry is exhaustive over RollKind, so indexing with the union's
	// discriminant yields a union of handlers; widening to the union-typed
	// handler keeps the per-kind hooks callable with the union request (their
	// Extract<RollRequest, { kind: K }> parameter resolves to RollRequest).
	const handler = rollHandlers[request.kind] as RollHandler<RollKind>;
	const prepared = await handler.prepare(request);
	if (!prepared) return;
	const view = actorView(request.actor);

	let dialog: TestDialogResultLike | null = null;
	let modifiers = prepared.initialModifiers;
	if (!request.skipDialog) {
		// Guarded affliction/talent conditions (bead xu83): offer a pre-roll
		// toggle for every guard that could apply to this test, and re-collect
		// the visible rows when one is switched on so the preview matches.
		const conditionScope = {
			kind: prepared.testKind,
			key: prepared.testKey,
			weapon: prepared.weapon,
			skillName: prepared.context.skillName,
		};
		const conditions = collectConditionKeys(
			view,
			conditionScope,
		).filter(
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
			...conditions.length > 0
				? {
						conditions,
						collectForConditions: (flags: Record<string, boolean>) =>
							collectTestModifiers(
								view,
								{ ...conditionScope, flags },
								modifiers,
							),
					}
				: {},
		});
		if (result === null) return;
		dialog = result;
		modifiers = result.modifiers;
	}

	modifiers = [
		...modifiers,
		...(handler.postDialogModifiers?.(request, prepared, dialog ?? {
			modifiers: [],
		}) ?? []),
	];

	const baseContext =
		handler.testContext?.(request, prepared, dialog) ?? prepared.context;
	// Guarded-condition flags chosen in the dialog join the funnel context for
	// every roll kind (bead xu83), not only weapon attacks.
	const context = dialog?.flags
		? { ...baseContext, flags: { ...baseContext.flags, ...dialog.flags } }
		: baseContext;

	const { outcome, messageId, target } = await runTest(
		view,
		prepared,
		modifiers,
		context,
	);
	await handler.after?.(request, prepared, outcome, messageId, {
		target,
		modifiers,
	});
}

// ---------------------------------------------------------------------------
// Compatibility wrappers (game.rogueTrader.* API + sheet entry points)
// ---------------------------------------------------------------------------

/** Legacy options shape shared by the exported roll functions. */
export interface RollTestOptions {
	/** Dialog-provided or programmatic modifiers. */
	modifiers?: Modifier[];
	/** Bypass the modify dialog (fast-forward). */
	skipDialog?: boolean;
}

/**
 * Run a skill test WITHOUT the dialog and return the outcome (bead ks3k).
 *
 * For rules that must act on the Degrees of Success rather than merely post a
 * card — the Tau battlesuit repair test is the first caller. The passed
 * modifiers go through the same funnel collection as any other roll, so the
 * contributor breakdown on the card stays honest: this is a fast-forward, not
 * a silent roll, and the caller sees the same outcome the player sees.
 *
 * Returns null when the request could not be prepared (no such skill item),
 * which callers report rather than treating as a failure.
 */
export async function rollSkillOutcome(
	actor: Actor,
	itemId: string,
	modifiers: Modifier[] = [],
): Promise<TestOutcome | null> {
	const prepared = await skillHandler.prepare({
		kind: "skill",
		actor,
		itemId,
		modifiers,
	});
	if (!prepared) return null;
	const { outcome } = await runTest(
		actorView(actor),
		prepared,
		[...prepared.initialModifiers, ...modifiers],
		{ skillName: prepared.context.skillName },
	);
	return outcome;
}

/** Roll a characteristic test: dialog -> funnel -> kernel -> chat card. */
export async function rollTest(
	actor: Actor,
	key: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "characteristic",
		actor,
		key,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/**
 * Untrained attempt of a basic skill: characteristic value with the RAW -10
 * penalty expressed as a funnel modifier (breakdown shows it explicitly).
 * Advanced skills cannot be attempted untrained (enforced by callers).
 */
export async function rollSkillUntrained(
	actor: Actor,
	label: string,
	characteristicKey: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "skill",
		actor,
		characteristicKey,
		label,
		skipDialog: options.skipDialog,
	});
}

/** Roll a skill item test: target = characteristic value + ladder bonus. */
export async function rollSkill(
	actor: Actor,
	skillItemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "skill",
		actor,
		itemId: skillItemId,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/** Roll a weapon attack's to-hit test. */
export async function rollWeaponAttack(
	actor: Actor,
	weaponId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "weapon",
		actor,
		itemId: weaponId,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/** Psychic power activation (Core Rulebook Ch. VI). */
export async function rollPsychicPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({ kind: "psychic", actor, itemId, skipDialog: options.skipDialog });
}

/** Navigator power activation (Core Rulebook Ch. VII book p178). */
export async function rollNavigatorPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({ kind: "navigator", actor, itemId, skipDialog: options.skipDialog });
}

/**
 * Fear Test (bead jpbm, Core Rulebook p295): the confronted character makes
 * a Willpower test against the source's Fear (X) severity. Talents and
 * traits feed the check via the funnel (guarded effects with condition
 * "fear") and fear-immunity/fear-reroll effect kinds.
 */
export async function rollFearTest(
	actor: Actor,
	rating: number,
	options: {
		situation?: "combat" | "non-combat";
		sourceName?: string;
		modifiers?: Modifier[];
		skipDialog?: boolean;
	} = {},
): Promise<void> {
	await performRoll({
		kind: "fear",
		actor,
		rating,
		situation: options.situation,
		sourceName: options.sourceName,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/** Ship weapon salvo (bead xfta, Core Rulebook pp220-222). */
export async function rollShipSalvo(
	actor: Actor,
	itemId: string,
	rangeBand: "half" | "normal" | "long" = "normal",
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "ship-weapon",
		actor,
		itemId,
		rangeBand,
		skipDialog: options.skipDialog,
	});
}

/** Emergency Repairs extended action (bead xfta, book p216-218). */
export async function rollShipRepair(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "ship-repair",
		actor,
		itemId,
		skipDialog: options.skipDialog,
	});
}

/**
 * "Snap out of it" (Core Rulebook p296): a Willpower Test at the beginning
 * of the character's Turn; success ends the snap-out-capable condition.
 * Failure keeps the condition (the player may test again next Turn).
 */
export async function rollSnapOut(
	actor: Actor,
	options: RollTestOptions = {},
): Promise<void> {
	const ports = getPorts();
	if (!snapOutReady(actor)) {
		ports.notify.warn("FEAR.SNAP_OUT_NONE");
		return;
	}
	const characteristic = systemOf(actor).characteristics.wp;
	if (!characteristic) {
		ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", { key: "wp" });
		return;
	}
	const view = actorView(actor);
	const modifiers = [...(options.modifiers ?? [])];
	const title = `${actor.name} — ${ports.i18n.t("FEAR.SNAP_OUT")}`;
	let finalModifiers = modifiers;
	let finalFlags: Record<string, boolean> = { snapOut: true };
	if (!options.skipDialog) {
		// Guarded condition toggles (bead xu83): all-test afflictions like
		// Night Eyes / Irrational Nausea can guard a Willpower test too.
		const conditionScope = {
			kind: "characteristic" as const,
			key: "wp",
			weapon: null,
		};
		const conditions = collectConditionKeys(view, conditionScope);
		const result = await TestDialog.show({
			title,
			baseTarget: characteristic.value,
			contributors: dialogContributors(
				view,
				"characteristic",
				"wp",
				modifiers,
				null,
			),
			...conditions.length > 0
				? {
						conditions,
						collectForConditions: (flags: Record<string, boolean>) =>
							collectTestModifiers(
								view,
								{ ...conditionScope, flags },
								modifiers,
							),
					}
				: {},
		});
		if (result === null) return;
		finalModifiers = result.modifiers;
		if (result.flags) finalFlags = { ...finalFlags, ...result.flags };
	}
	const { outcome } = await runTest(
		view,
		{
			title,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: "wp",
			initialModifiers: finalModifiers,
			weapon: null,
			context: { flags: finalFlags },
			templateVars: {},
			kindData: {},
		},
		finalModifiers,
		{ flags: finalFlags },
	);
	if (!outcome.success) {
		await postCard(actor, "systems/rogue-trader/template/chat/fear-shock.hbs", {
			title,
			shockText: ports.i18n.t("FEAR.SNAP_OUT_FAIL"),
		});
		return;
	}
	const carried = carriedConditions(actor).filter((c) => c.snapOut);
	const ids = carried.map((c) => c.id).filter((id) => id !== "");
	if (ids.length > 0) {
		await ports.actors.deleteEffects(actor, ids);
	}
	await postCard(actor, "systems/rogue-trader/template/chat/fear-shock.hbs", {
		title,
		shockText: ports.i18n.t("FEAR.SNAP_OUT_SUCCESS"),
	});
}
