/**
 * Roll system — compatibility shim (epic kof0, phase 4).
 *
 * The roll pipeline moved to presentation/rolls/*: it drives dialogs, posts
 * chat cards and writes actor documents, so it is presentation, not rules.
 * What lives where now:
 *
 *   rules/roll-contract.ts        the request union + handler contract (types)
 *   presentation/rolls/pipeline   dialogContributors + runTest
 *   presentation/rolls/<kind>.ts  one handler per roll kind
 *   presentation/rolls/evasion    the weapon after-hook's reaction prompt
 *   presentation/rolls/perform    performRoll + the public roll API
 *   presentation/rolls/ship       the ship salvo / repair handlers
 *
 * This module keeps the established import paths working (sheets, adapter.ts,
 * game.rogueTrader.*) and is now a pure re-export.
 *
 * Behaviour is preserved 1:1 from the pre-refactor adapter sequences:
 * dialog visibility, contributor merging, post-dialog rows, card contents
 * and chat flags are all carried over verbatim.
 */

export {
	characteristicHandler,
	skillHandler,
} from "../presentation/rolls/characteristic-skill";
export { resolveEvasion } from "../presentation/rolls/evasion";
export { fearHandler } from "../presentation/rolls/fear";
export { navigatorHandler } from "../presentation/rolls/navigator";
export {
	performRoll,
	rollFearTest,
	rollHandlers,
	rollNavigatorPower,
	rollPsychicPower,
	rollShipRepair,
	rollShipSalvo,
	rollSkill,
	rollSkillOutcome,
	rollSkillUntrained,
	rollSnapOut,
	rollTest,
	rollWeaponAttack,
} from "../presentation/rolls/perform";
export type { RollTestOptions } from "../presentation/rolls/perform";
export { dialogContributors, runTest } from "../presentation/rolls/pipeline";
export { psychicHandler } from "../presentation/rolls/psychic";
export { shipRepairHandler, shipWeaponHandler } from "../presentation/rolls/ship";
export { weaponHandler } from "../presentation/rolls/weapon";

export type {
	CharacteristicRollRequest,
	FearRollRequest,
	NavigatorRollRequest,
	PreparedRoll,
	PsychicRollRequest,
	RollBase,
	RollContext,
	RollHandler,
	RollKind,
	RollRequest,
	ShipRepairRollRequest,
	ShipWeaponRollRequest,
	SkillRollRequest,
	TestDialogResultLike,
	WeaponRollRequest,
} from "./roll-contract";
