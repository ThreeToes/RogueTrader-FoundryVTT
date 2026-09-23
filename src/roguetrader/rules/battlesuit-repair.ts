/**
 * Tau battlesuit repair driver (bead ks3k / Tau Character Guide p31):
 * "Removing a Battlesuit Critical Effect requires a Hard (–20) Tech-Use or
 * Trade (Armourer) Test that takes at least an hour."
 *
 * Lives beside — not inside — `rules/criticals.ts` on purpose: this module
 * needs the roll system (and therefore the test dialog, which touches
 * `foundry.applications` at module load), while the critical maths and the
 * actor reading in `criticals.ts` must stay importable without Foundry up
 * (their unit tests run standalone).
 *
 * The Test is rolled through the normal skill path — fast-forward, so no
 * dialog, but the −20 is a real funnel modifier and shows in the contributor
 * breakdown on the card. The Degrees of Success drive the removal; the player
 * never reports a number.
 */

import type { Modifier } from "../../rules-engine/src/modifier";
import { repairBattlesuitCriticals, repairSkillFor } from "./criticals";
import { rollSkillOutcome } from "./roll-system";

/** The book's fixed modifier for the repair Test. */
export const REPAIR_TEST_MODIFIER = -20;

export async function rollBattlesuitRepair(actor: unknown): Promise<{
	removed: number;
	remaining: number;
	degrees: number;
} | null> {
	const skill = repairSkillFor(actor);
	if (!skill?.id) {
		ui.notifications?.warn(game.i18n!.localize("CRITICAL.REPAIR_NO_SKILL"));
		return null;
	}
	const modifier: Modifier = {
		id: "battlesuit-repair-hard",
		source: {
			type: "macro",
			label: game.i18n!.localize("CRITICAL.REPAIR_MODIFIER"),
		},
		label: game.i18n!.localize("CRITICAL.REPAIR_MODIFIER"),
		value: REPAIR_TEST_MODIFIER,
	};
	const outcome = await rollSkillOutcome(
		(actor ?? {}) as never,
		skill.id,
		[modifier],
	);
	if (!outcome) return null;
	// A failed Test removes nothing; a success removes one plus one per Degree.
	const degrees = outcome.success ? outcome.degrees : -1;
	const { removed, remaining } = await repairBattlesuitCriticals(
		actor,
		degrees,
	);
	ui.notifications?.info(
		game.i18n!.format("CRITICAL.REPAIRED", { count: String(removed) }),
	);
	return { removed, remaining, degrees };
}
