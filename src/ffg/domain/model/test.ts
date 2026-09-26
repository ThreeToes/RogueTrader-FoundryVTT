/**
 * The test-kind vocabulary, owned by the domain so the effect engine can key
 * on it without importing the funnel (which lives in the adapter layer during
 * the migration). `funnel.ts` re-exports this for compatibility.
 */
export type TestKind =
	| "characteristic"
	| "skill"
	| "attack"
	| "vehicle-handling"
	// Focus Power Test (bead sa6, Core Rulebook p157): a Characteristic/Skill
	// test with the +5-per-effective-PR bonus expressed as a funnel-visible
	// modifier.
	| "focus-power"
	// Fear Test (bead jpbm, Core Rulebook p295): a Willpower test whose
	// severity penalty is a funnel-visible modifier; context flag "fear" lets
	// authored guarded effects apply here only.
	| "fear";
