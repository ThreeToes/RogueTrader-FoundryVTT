/**
 * The roll API surface and the handler registry (epic kof0, phase 4),
 * extracted from rules/roll-system.ts.
 *
 * The request -> handler map lives here; the pipeline itself (ownership gate
 * -> prepare -> dialog -> post-dialog rows -> shared test -> after) is the
 * handler-agnostic core in orchestrator.ts (bead 1uai) — performRoll maps the
 * request kind onto the registry and delegates. Keeping the registry OUT of
 * the orchestrator is what breaks the old evasion -> perform -> handlers ->
 * weapon -> evasion cycle: the weapon handler's after-hook calls
 * resolveEvasion, which now re-enters through orchestrator.ts directly with
 * the skill handler, never looping back into this module.
 *
 * The handler registry is exhaustive over RollKind, so adding a kind is a
 * compile error until its handler exists and performRoll never needs editing.
 */

import { type Modifier, type TestOutcome } from "../../../rules-engine/index";
import { getPorts } from "../../infrastructure/foundry/ports";
import { effectiveProfile } from "../../rules/homebrew";
import { toxicToughnessModifier } from "../../rules/toxic";
import type {
	RollHandler,
	RollKind,
	RollRequest,
} from "../../rules/roll-contract";
import { shipRepairHandler, shipWeaponHandler } from "./ship";
import { shipActionHandler } from "./ship-action";
import { actionHandler } from "./action";
import { characteristicHandler, skillHandler } from "./characteristic-skill";
import { fearHandler } from "./fear";
import { initiativeHandler } from "./initiative";
import { navigatorHandler } from "./navigator";
import { psychicHandler } from "./psychic";
import { snapOutHandler } from "./snap-out";
import { weaponHandler } from "./weapon";
import { runRoll } from "./orchestrator";

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
	"ship-action": shipActionHandler,
	fear: fearHandler,
	"snap-out": snapOutHandler,
	initiative: initiativeHandler,
	action: actionHandler,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function performRoll(
	request: RollRequest,
): Promise<TestOutcome | null> {
	// The registry is exhaustive over RollKind, so indexing with the union's
	// discriminant yields a union of handlers; widening to the union-typed
	// handler keeps the per-kind hooks callable with the union request (their
	// Extract<RollRequest, { kind: K }> parameter resolves to RollRequest).
	const handler = rollHandlers[request.kind] as RollHandler<RollKind>;
	return runRoll(request, handler);
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
	// bead n0tp: routed through performRoll so the ownership gate applies —
	// this used to hand-roll prepare -> runTest and skipped it, letting a
	// non-owner roll another character's battlesuit repair. skipDialog keeps
	// the fast-forward contract: no dialog, but the same funnel-modified test
	// and the same card the player sees.
	return await performRoll({
		kind: "skill",
		actor,
		itemId,
		modifiers,
		skipDialog: true,
	});
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
 * Untrained attempt of a basic skill: the target comes from the profile's
 * untrainedSkill model (bead tval) — HALF the governing Characteristic,
 * round down (Core Rulebook p74). Advanced skills cannot be attempted
 * untrained (enforced by callers).
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

/**
 * Toxic quality Toughness Test (bead d8bc, owner rule text; Core Rulebook
 * printed p117): the victim immediately makes a Toughness Test at −5 per
 * point of Damage taken from the toxic hit; failure inflicts the toxin's
 * secondary effects. The penalty is a VISIBLE funnel modifier (breakdown in
 * the TestDialog and on the card) via toxicToughnessModifier. Rolled for the
 * TARGET actor — typically the GM presses the damage card's button — so the
 * ownership gate in performRoll enforces it loudly when someone else tries.
 */
export async function rollToxicToughnessTest(
	target: Actor,
	woundsAfterSoak: number,
): Promise<void> {
	await performRoll({
		kind: "characteristic",
		actor: target,
		key: "t",
		modifiers: [
			toxicToughnessModifier(
				woundsAfterSoak,
				getPorts().i18n.t("CHAT.TOXIC_MODIFIER"),
				effectiveProfile(getPorts().config),
			),
		],
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
	await performRoll({
		kind: "psychic",
		actor,
		itemId,
		skipDialog: options.skipDialog,
	});
}

/** Navigator power activation (Core Rulebook Ch. VII book p178). */
export async function rollNavigatorPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "navigator",
		actor,
		itemId,
		skipDialog: options.skipDialog,
	});
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

/** Ship weapon salvo (bead xfta, Core Rulebook pp220-222). An
 * "out-of-range" band is refused by the handler (Core Rulebook pp219-220,
 * bead 3ba1). */
export async function rollShipSalvo(
	actor: Actor,
	itemId: string,
	rangeBand: "half" | "normal" | "long" | "out-of-range" = "normal",
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
 * A ship action (epic necp bead oumh, Core Rulebook pp213-218): a Table 8-10
 * Manoeuvre or Table 8-11 Extended Action, rolled on the starship as a
 * combined test (the character's skill + the ship's ability, p212). When no
 * performer is passed the crew-quality skill substitutes (Table 8-9); when a
 * performer is passed without the trained skill the handler refuses loudly.
 */
export async function rollShipAction(
	actor: Actor,
	itemId: string,
	options: {
		/** The helmsman/officer performing the action (owner decision 1). */
		performer?: Actor;
	} & RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "ship-action",
		actor,
		itemId,
		performer: options.performer,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/**
 * Roll a combat action's printed test (bead et5a, epic moew): the entry is
 * the warmed actions-catalog snapshot — the actions tab resolves it off the
 * chip click before dispatching (see sheet/actor/actions-view.ts). The
 * handler delegates the underlying test to the characteristic/skill paths
 * and lands the printed difficulty as a visible modifier row.
 */
export async function rollAction(
	actor: Actor,
	entry: Extract<RollRequest, { kind: "action" }>["entry"],
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "action",
		actor,
		entry,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/**
 * "Snap out of it" (bead n0tp, Core Rulebook p296): a Willpower Test at the
 * beginning of the character's Turn; success ends the snap-out-capable
 * condition. Failure keeps the condition (the player may test again next
 * Turn). Routed through performRoll, which owns the dialog, the funnel and
 * the ownership gate — the hand-rolled prepare/dialog/runTest sequence here
 * skipped that gate, letting a non-owner roll another character's snap-out.
 */
export async function rollSnapOut(
	actor: Actor,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "snap-out",
		actor,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/**
 * Initiative (bead 77r1): routed through performRoll, which owns the
 * ownership gate and the modifier dialog — the hand-rolled dialog/merge/dice
 * card sequence in rules/adapter.ts skipped the gate, letting a non-owner
 * roll another character's initiative. The handler is prepare-only (the kind
 * is a raw d10, no pass/fail test); the total is reported on the card, not
 * the return value.
 */
export async function rollInitiativeAction(
	actor: Actor,
): Promise<TestOutcome | null> {
	// Prepare-only kinds return no kernel outcome — always null today.
	return await performRoll({ kind: "initiative", actor });
}