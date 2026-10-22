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

import type { Modifier } from "../../rules-engine/modifier";
import type {
	ConfigPort,
	I18n,
	Notify,
} from "../../ffg/application/ports";
import { effectiveProfile } from "./homebrew";
import { repairBattlesuitCriticals, repairSkillFor } from "./criticals";
import { rollSkillOutcome } from "./roll-system";

/** The book's fixed modifier for the repair Test. */
export const REPAIR_TEST_MODIFIER = -20;

export async function rollBattlesuitRepair(
	actor: unknown,
	// Bead x4ly: the notify/i18n/config ports are caller-bound — the sheet
	// threads its own, a second system binds theirs — not a global read.
	ports: { notify: Notify; i18n: I18n; config: ConfigPort },
): Promise<{
	removed: number;
	remaining: number;
	degrees: number;
} | null> {
	const skill = repairSkillFor(actor);
	if (!skill?.id) {
		ports.notify.warn("CRITICAL.REPAIR_NO_SKILL");
		return null;
	}
	const label = ports.i18n.t("CRITICAL.REPAIR_MODIFIER");
	// Bead wxut.2: the Hard (-20) is profile DATA read from the effective
	// profile; REPAIR_TEST_MODIFIER stays the core value and registry source.
	const effective = effectiveProfile(ports.config);
	const value = Number.isFinite(effective.repairTestModifier)
		? effective.repairTestModifier
		: REPAIR_TEST_MODIFIER;
	const modifier: Modifier = {
		id: "battlesuit-repair-hard",
		source: {
			type: "macro",
			label,
		},
		label,
		value,
	};
	const outcome = await rollSkillOutcome((actor ?? {}) as never, skill.id, [
		modifier,
	]);
	if (!outcome) return null;
	// A failed Test removes nothing; a success removes one plus one per Degree.
	const degrees = outcome.success ? outcome.degrees : -1;
	const { removed, remaining } = await repairBattlesuitCriticals(
		actor,
		degrees,
	);
	ports.notify.info("CRITICAL.REPAIRED", { count: String(removed) });
	return { removed, remaining, degrees };
}
