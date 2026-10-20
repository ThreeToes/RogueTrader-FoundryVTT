/**
 * Combat-action roll handler (bead et5a, epic moew): the actions tab's
 * roll-spec chips enter the EXISTING roll pipeline here — no forked funnel.
 *
 * The pack's printed test vocabulary (the actions pack guard test's
 * ROLL_VOCAB) maps onto the existing handlers' prepare paths, so talent/
 * gear effects keyed to the underlying tests keep applying and the
 * TestDialog/skillName context stays honest:
 *
 * - `weapon-skill`  → the characteristic handler ("ws") — Weapon Skill is a
 *   CHARACTERISTIC in this system;
 * - `ballistic-skill` → the characteristic handler ("bs");
 * - `strength`      → the characteristic handler ("s");
 * - `dodge`         → the skill handler through the actor's trained Dodge
 *   skill item when owned, the untrained fallback otherwise (evasion.ts's
 *   Dodge-untrained precedent: HALF Agility round down via the profile's
 *   untrainedSkill model, Core Rulebook p74).
 *
 * The printed difficulty (entry.difficulty, classified in rules/actions) is
 * the book's OWN data: a numeric label ("Hard (–20)") lands as a PRE-DIALOG
 * modifier row so the TestDialog shows it visibly; "Opposed" adds NO
 * modifier — opposed rolls stay MANUAL per the owner's ruling (the
 * instigator rolls, the defender rolls their side separately), and the
 * result card says so.
 *
 * The after-hook posts the action RESULT card: the lookup-card anatomy
 * (the action's name as the compendium doc link, cost, terse description)
 * carrying the roll result. The inline roll card names the action too (the
 * titleDoc template var), so both cards point at the pack prose.
 */

import type { Modifier } from "../../../rules-engine/index";
import {
	actionLookupTitleDoc,
	ACTION_ROLL_TEMPLATE,
	actionRollCardVars,
	type ActionEntry,
} from "../../rules/actions";
import type { RollHandler } from "../../rules/roll-contract";
import { postCard } from "../../rules/chat-flags";
import { getPorts } from "../../infrastructure/foundry/ports";
import { outcomeLabel } from "../../../ffg/presentation/rolls/pipeline";
import { characteristicHandler, skillHandler } from "./characteristic-skill";
import { findOwnedSkillItem, untrainedCharacteristicFor } from "./skill-lookup";

// ------------------------------------------------------------- the test vocabulary

/** Where a printed test key routes. */
type RollRoute =
	| { handler: "characteristic"; key: string }
	| { handler: "dodge-skill" };

/**
 * The printed test vocabulary → the existing handlers' prepare paths
 * (delegation, not a fork). Unmapped keys fail via the handler's loud
 * warning; extending this table is a deliberate choice pinned by the pack
 * guard test's ROLL_VOCAB.
 */
const ROLL_ROUTES: Record<string, RollRoute> = {
	"weapon-skill": { handler: "characteristic", key: "ws" },
	"ballistic-skill": { handler: "characteristic", key: "bs" },
	strength: { handler: "characteristic", key: "s" },
	dodge: { handler: "dodge-skill" },
};

/**
 * The dodge route: the trained skill item when owned (the evasion
 * reaction's name match, via the shared lookup — bead bw9x), the untrained
 * fallback characteristic otherwise (skill-lookup.ts's table, which carries
 * the evasion precedent: HALF Agility round down via the profile's
 * untrainedSkill model, Core Rulebook p74). Dodge is resolved at prepare
 * time so skill-keyed effects ride the trained path's skillName context.
 */
function dodgeSkillRoute(actor: Actor): {
	itemId?: string;
	characteristicKey?: string;
} {
	const skill = findOwnedSkillItem(actor, "Dodge");
	if (skill?.id) return { itemId: skill.id };
	return { characteristicKey: untrainedCharacteristicFor("Dodge") };
}

// ------------------------------------------------------------- difficulty row

/**
 * The printed difficulty as a pre-dialog modifier row (bead et5a): visible
 * in the TestDialog breakdown and on the card, deduped by the funnel like
 * any other row. Only NUMERIC difficulties become rows — the label is the
 * PRINTED book text ("Hard (–20)") because that is what the extraction
 * carries; "none" prints no row and "opposed" stays manual (no modifier).
 */
export function actionDifficultyRow(entry: ActionEntry): Modifier | null {
	const { difficulty } = entry;
	if (difficulty.kind !== "numeric") return null;
	return {
		id: "action:difficulty",
		source: { type: "item", label: "ACTION.DIFFICULTY" },
		label: entry.rollDifficulty,
		value: difficulty.value,
	};
}

// ---------------------------------------------------------------- the handler

/** Combat-action roll (rollAction; the actions tab's roll-spec chips). */
export const actionHandler: RollHandler<"action"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		const entry = request.entry;

		// Unmapped printed test: the loud path, not a silent no-op (the ports
		// convention; the chip click's caller sees the toast).
		const route = ROLL_ROUTES[entry.rollTest];
		if (!route) {
			ports.notify.warn("ACTION.ROLL_UNKNOWN", {
				test: entry.rollTest || "—",
				action: entry.name,
			});
			return null;
		}

		// DELEGATE the underlying test to the existing handlers: their prepare
		// resolves the target, skill-item context and funnel scoping — this
		// handler only adds the action's own title, difficulty and cards.
		let underlying = null;
		if (route.handler === "characteristic") {
			underlying = await characteristicHandler.prepare({
				kind: "characteristic",
				actor,
				key: route.key,
			});
		} else {
			const dodge = dodgeSkillRoute(actor);
			underlying = await skillHandler.prepare(
				dodge.itemId !== undefined
					? { kind: "skill", actor, itemId: dodge.itemId }
					: // Untrained fallback (the evasion precedent): HALF the
						// governing characteristic from the skill-lookup table
						// (SystemProfile.untrainedSkill, Core Rulebook p74).
						{
							kind: "skill",
							actor,
							characteristicKey: dodge.characteristicKey,
							label: "Dodge",
						},
			);
		}
		if (!underlying) return null;

		const opposed = entry.difficulty.kind === "opposed";
		const difficultyRow = actionDifficultyRow(entry);
		return {
			...underlying,
			// The dialog/card title names the ACTION being performed, not the
			// underlying characteristic the delegation resolved.
			title: `${actor.name} — ${entry.name}`,
			initialModifiers: [
				...(underlying.initialModifiers ?? []),
				...(request.modifiers ?? []),
				...(difficultyRow ? [difficultyRow] : []),
			],
			// The inline roll card names the action via the pack-doc link too.
			templateVars: { titleDoc: actionLookupTitleDoc(entry) },
			kindData: { entry, opposed },
		};
	},

	async after(request, prepared, outcome, _messageId, info) {
		// prepare() always sets kindData for an action; the guard keeps the
		// payload typed like the fear handler's (bead ezys).
		const data = prepared.kindData;
		if (!data) return;
		const ports = getPorts();
		// Bead obbp: the SAME interpolated key the shared pipeline renders — the
		// literal "(+N degrees)" scaffolding stays in the lang files, not in
		// hand-concatenated English word order here.
		const outcomeText = outcomeLabel(outcome.success, outcome.degrees);
		await postCard(
			request.actor,
			ACTION_ROLL_TEMPLATE,
			actionRollCardVars({
				entry: data.entry,
				labels: {
					cost: ports.i18n.t("ACTION.COST"),
					description: ports.i18n.t("ACTION.DESCRIPTION"),
				},
				result: {
					target: info?.target ?? prepared.baseTarget,
					roll: outcome.roll,
					outcomeLabel: outcomeText,
					outcomeClass: outcome.success ? "success" : "failure",
					opposedNote: data.opposed
						? ports.i18n.t("ACTION.OPPOSED_MANUAL")
						: "",
				},
			}),
		);
	},
};