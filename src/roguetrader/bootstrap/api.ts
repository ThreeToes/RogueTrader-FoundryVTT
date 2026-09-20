/**
 * The public roll API for modules and macros (bead mvu2; epic kof0, phase 5).
 *
 * `game.rogueTrader.*` is the documented extension surface: the full roll set
 * plus performRoll, so a module can define its own request kinds and reuse the
 * pipeline. Split out of the sheet/init.ts composition root.
 */

import {
	performRoll,
	rollFearTest,
	rollNavigatorPower,
	rollPsychicPower,
	rollSkill,
	rollSkillUntrained,
	rollSnapOut,
	rollTest,
	rollWeaponAttack,
} from "../rules/adapter";

/** Attach the roll API to the `game` object. */
export function registerRollApi(): void {
	const git = game as unknown as { rogueTrader?: Record<string, unknown> };
	git.rogueTrader ??= {};
	git.rogueTrader.performRoll = performRoll;
	git.rogueTrader.rollTest = rollTest;
	git.rogueTrader.rollSkill = rollSkill;
	git.rogueTrader.rollSkillUntrained = rollSkillUntrained;
	git.rogueTrader.rollWeaponAttack = rollWeaponAttack;
	git.rogueTrader.rollPsychicPower = rollPsychicPower;
	git.rogueTrader.rollNavigatorPower = rollNavigatorPower;
	git.rogueTrader.rollFearTest = rollFearTest;
	git.rogueTrader.rollSnapOut = rollSnapOut;
}
