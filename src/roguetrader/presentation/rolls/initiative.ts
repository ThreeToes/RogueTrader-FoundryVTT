/**
 * The initiative handler (bead 77r1). rollInitiativeAction (epic wjpi,
 * bead dt8t; reworked bead yxm5) used to hand-roll the full
 * dialog -> modifier merge -> dice -> card sequence INSIDE rules/adapter.ts,
 * bypassing the roll pipeline — no ownership gate, a hand-invoked merge,
 * duplicated TestDialog/card plumbing. It now runs through the pipeline like
 * every other kind.
 *
 * The kind still genuinely differs: initiative is a RAW d10 (Core Rulebook
 * p212) + the derived initiative bonus — no target and NO pass/fail ladder,
 * so the shared test step (funnel -> d100 -> kernel resolveTest -> roll card)
 * would be wrong. The handler is therefore prepare-only (PreparedRoll
 * .prepareOnly, orchestrator.ts): the pipeline owns the ownership gate and
 * the modifier dialog; this handler's after-hook owns the d10, the
 * combatant write and the initiative card.
 *
 * The funnel path (bead yxm5, re-pinned by the parity test bead zl6e):
 * contributors = the Agility-Bonus base row + the live `initiative`-keyed
 * modifier rows collected from the owned inventory via the ONE collector
 * (rules/initiative-rows.ts) + any dialog custom rows, merged by id. The
 * generic funnel collection is NOT used for this dialog: its test channel
 * admits wildcard rows (empty testKey matches ANY test) — exactly the row
 * shape a bulk tracker formula cannot carry, so the collector-pinned set is
 * what both initiative routes agree on.
 *
 * Wildcard funnel rows stay out of the algebra on both routes (the tracker's
 * bulk formula roll keys on the explicit "initiative" rows only), guarded
 * rows count only when their condition flag is set — and the dialog offers
 * NO condition toggles here (the old dialog offered none, and a toggle's
 * generic re-collection would leak wildcards into a parity-pinned set). Bead
 * 4tx6: that suppression is structural in the orchestrator (prepare-only
 * kinds never receive generic condition toggles at all), so this handler
 * carries no handledConditionFlags list that could drift from runRoll's own
 * condition scope.
 */

import { breakdown, mergeModifiers } from "../../../ffg/application/funnel";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import { systemOf } from "../../data/accessors";
import { collectInitiativeRows } from "../../rules/initiative-rows";
import { postCard } from "../../rules/chat-flags";
import type { RollHandler } from "../../rules/roll-contract";
import { sumModifiers, type Modifier } from "../../../rules-engine/index";
import { getPorts } from "../../infrastructure/foundry/ports";

/** One combatant document on the active tracker (combat-end.ts precedent). */
interface CombatantLike {
	actorId?: string;
	update: (data: object) => Promise<unknown>;
}

/**
 * The ship's Detection TENS DIGIT (bead qkq1, Core Rulebook p212-213): the
 * captain's 1d10 adds the ship's Detection BONUS — the tens digit.
 */
export function shipDetectionBonus(detection: number): number {
	return Math.floor(detection / 10);
}

/**
 * Is the ship currently boarded (bead qkq1; the boarding pair is S2's
 * `boardedWith` uuid-or-null on the ship actor)? Read DEFENSIVELY — the
 * parallel bead may not have merged into this worktree yet, so a missing
 * field reads as unset (the schema-first field lands with S2; note on the
 * bead). Never a loud failure: boarding is a state, not corrupt data.
 */
export function shipBoarded(system: unknown): boolean {
	const boardedWith = (system as { boardedWith?: unknown } | null | undefined)
		?.boardedWith;
	// uuid-or-null: only a non-empty uuid counts as locked.
	return typeof boardedWith === "string" && boardedWith.length > 0;
}

/**
 * "Roll for initiative" (bead 77r1 + bead qkq1): one kind, TWO paths per
 * actor shape.
 *
 * - CHARACTER (bead 77r1/yxm5): a raw d10 + the initiative bonus — the
 *   Agility-bonus base row + the collector-pinned `initiative` rows.
 * - STARSHIP (bead qkq1, Core Rulebook p212-213): a raw d10 + the ship's
 *   Detection TENS DIGIT — the captain rolls, character bonuses do NOT
 *   apply, and there are no owned-item rows at all. The ship card also
 *   carries the combat-start note lines (Surprise, NPC action cap; MANUAL
 *   rulings — no automation in v1) and the Boarding banner when the ship's
 *   `boardedWith` is set (the pair drops to last — p215; tracker-side
 *   reordering stays GM-manual).
 */
export const initiativeHandler: RollHandler<"initiative"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		const system = systemOf(actor) as unknown as
			| (Record<string, unknown> & { characteristicBonus?: unknown })
			| null;

		// STARSHIP PATH (bead qkq1, Core Rulebook p212-213). Schema-first: the
		// actor type resolves to the registered StarshipActor model, whose
		// statline Detection field is the rule's input.
		if ((actor as { type?: string }).type === "starship") {
			// Fail LOUDLY on missing Detection (the bead's gate: corrupt data
			// must not look like a broken button — contrast the character path's
			// silent shape gate, which the token menu hides instead).
			if (typeof system?.detection !== "number") {
				ports.notify.error("ROLL.INITIATIVE_NO_DETECTION", {
					actor: (actor as { name?: string }).name ?? "?",
				});
				return null;
			}
			return {
				title: `${actor.name} — ${ports.i18n.t("ROLL.INITIATIVE_TITLE")}`,
				// The d10 cap; no pass/fail ladder (prepare-only), exactly like
				// the character path.
				baseTarget: 10,
				testKind: "characteristic",
				testKey: "initiative",
				// No owned-item rows for ships: the book's rule is the Detection
				// tens digit ALONE (character initiative bonuses do not apply),
				// so no collector pass — the dialog still admits manual custom
				// rows (the GM's ruling adjustments).
				initialModifiers: [
					{
						id: "initiative-base:detection",
						source: { type: "item", label: "ROLL.BASE" },
						label: ports.i18n.t("ROLL.INITIATIVE_DETECTION"),
						value: shipDetectionBonus(system.detection),
					},
				],
				weapon: null,
				context: {},
				prepareOnly: true,
				// No handledConditionFlags list: the suppression is STRUCTURAL —
				// the orchestrator offers no generic condition toggles for
				// prepare-only kinds at all (bead 4tx6), so no list here has to
				// match runRoll's own condition scope.
				kindData: { starship: true, boarded: shipBoarded(system) },
			};
		}

		// CHARACTER PATH (bead 77r1). Fail closed for non-character systems
		// (vehicles lack the Character model's characteristicBonus) — the
		// token-menu's visible() gate mirrors this so owned non-character tokens
		// never see a dead entry. This used to be rollInitiativeAction's own
		// shape gate.
		if (typeof system?.characteristicBonus !== "function") {
			return null;
		}
		const agBonus = (
			system as unknown as { characteristicBonus: (k: string) => number }
		).characteristicBonus("ag");
		// One collector — rules/initiative-rows.ts (bead zl6e) is the ONE
		// initiative-row collector both this path and the model's
		// initiativeBonus getter walk: explicit `testKey === "initiative"`
		// rows, structured key matching (never id text — a wildcard row
		// labelled "initiative" does not leak), and the SAME guard policy — a
		// guarded row counts only when its condition flag is set (the dialog
		// offers no toggles here — see the header — so guarded rows stay out
		// of a bulk-formula parity set; review finding 4).
		const view = actorView(actor);
		const collected = collectInitiativeRows(view.items);
		const rows: Modifier[] = [
			{
				id: "initiative-base:agility",
				source: { type: "item", label: "ROLL.BASE" },
				label: ports.i18n.t("ROLL.INITIATIVE_AGILITY_BONUS"),
				value: agBonus,
			},
			...collected,
		];
		return {
			title: `${actor.name} — ${ports.i18n.t("ROLL.INITIATIVE_TITLE")}`,
			// The d10 cap; the dialog's preview reads base + rows. There is no
			// pass/fail target — the shared test step is skipped entirely
			// (prepareOnly) and the after-hook sums the merged rows itself.
			baseTarget: 10,
			testKind: "characteristic",
			testKey: "initiative",
			initialModifiers: rows,
			weapon: null,
			context: {},
			prepareOnly: true,
			// No handledConditionFlags list: the suppression is STRUCTURAL —
			// the orchestrator offers no generic condition toggles for
			// prepare-only kinds at all (bead 4tx6), so no list here has to
			// match runRoll's own condition scope.
			kindData: { starship: false, boarded: false },
		};
	},

	dialogConfig(_request, prepared) {
		// Pin the dialog's fixed rows to the collector-driven set and disable
		// the difficulty select (a raw d10 has no pass/fail ladder): the
		// pipeline's generic test-channel collection would also admit wildcard
		// rows, which the tracker path can never count.
		return {
			difficultyLadder: [],
			contributors: [...prepared.initialModifiers],
		};
	},

	async after(request, prepared, _outcome, _messageId, info) {
		const ports = getPorts();
		const actor = request.actor;
		// The pipeline always passes info for prepare-only kinds; the
		// contract types it optional, so guard narrowly.
		const dialogRows = info?.modifiers ?? [];
		// The dialog result's rows (its own contributors + any custom rows the
		// player added) merge by id with the fixture rows, so nothing double-
		// counts — the same dedupe rule the shared prepare rows carry. The
		// MERGED set is both the arithmetic and the card's breakdown.
		const merged = mergeModifiers(dialogRows, prepared.initialModifiers);
		// Bead wvkd: the evaluated d10 rides the card so Dice So Nice!
		// animates it. Raw formula — no d100, no kernel. The sum is the
		// one in rules-engine (bead 4tx6: no inline reduce re-implementing
		// sumModifiers).
		const rolled = await ports.dice.roll("1d10");
		const total = rolled.total + sumModifiers(merged);
		// Combat integration: assign to EVERY combatant of this actor on the
		// active tracker (a multi-token actor keeps its tokens in step — the
		// old core path rolled all of them; review finding 3).
		const combatants = (
			game as { combat?: { combatants?: Iterable<CombatantLike> } | null }
		).combat?.combatants;
		const mine = combatants
			? [...combatants].filter(
					(c) => c.actorId === (actor as { id?: string }).id,
				)
			: [];
		for (const combatant of mine) {
			await combatant.update({ initiative: total } as never);
		}
		const assigned = mine.length > 0;
		const cardVars: Record<string, unknown> = {
			title: actor.name ?? "",
			value: total,
			analysis: breakdown(merged),
			assigned,
		};
		// Bead qkq1: the STARSHIP card also carries the combat-start manual
		// rulings (Core Rulebook p213 + p213-214) as note lines, and the
		// Boarding banner when the ship's `boardedWith` is set (p215) — both
		// visibility-only, no automation in v1. The character card stays as it
		// was (no notes key at all).
		if (prepared.kindData?.starship) {
			cardVars.notes = [
				"ROLL.INITIATIVE_NOTE_SURPRISE",
				"ROLL.INITIATIVE_NOTE_NPC_ACTIONS",
			];
			if (prepared.kindData.boarded) cardVars.boarded = true;
		}
		await postCard(
			actor,
			`${TEMPLATE_ROOT}chat/initiative.hbs`,
			cardVars,
			undefined,
			rolled.rolls,
		);
	},
};