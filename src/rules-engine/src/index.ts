export {
	type DamageOutcome,
	type DamageRequest,
	parseDamageFormula,
	resolveDamage,
} from "./damage";
export { type Modifier, sumModifiers } from "./modifier";
export { type RuleProfile, rtCore } from "./profile";
export {
	applyVoidShields,
	crewLossFromHullDamage,
	crippledEffects,
	SHIP_CRITICALS,
	shipCritical,
	criticalFromCrippledDamage,
	hitsScored,
	isCritical,
	type SalvoOutcome,
	type SalvoRequest,
	resolveSalvoDamage,
	type ShipCriticalEntry,
	type ShipWeaponKind,
	rangeModifier,
} from "./ship-combat";
export {
	locationForHit,
	resolveTest,
	type TestOutcome,
	type TestRequest,
} from "./test";
