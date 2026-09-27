/**
 * Per-game rule profiles.
 *
 * Everything that differs between FFG 40k systems (Dark Heresy 1&2, Rogue
 * Trader, Deathwatch, Black Crusade, Only War) must be expressed as profile
 * data, never as if/else inside resolvers. Adding DH2 or BC later means
 * adding a profile object, not code branches.
 *
 * NOTE: rtCore currently encodes remembered Rogue Trainer core rules; the
 * crit handling (doubles) is flagged for verification against the core book.
 */
export interface RuleProfile {
	/** Profile id, e.g. "rt-core". */
	id: string;
	/**
	 * A double (matching tens and units digits) occurred on the d100 roll.
	 * The kernel reports it as data; systems/profiles decide whether a double
	 * on success is a Critical Hit (RT core) or has other meaning.
	 */
	critOnDouble: boolean;
	/** Rolls at or above this value always fail (RT/DH1: 96+ when target < 96? core book check). */
	autoFailRoll: number | null;
	/** Rolls at or below this always succeed (DH1: 01-05 auto-pass). */
	autoPassRoll: number | null;
	/**
	 * Primitive armour rule: non-primitive weapons double wounds against
	 * primitive armour. (RT core; VERIFY book wording before shipping.)
	 */
	primitiveArmourDouble: boolean;
	/**
	 * Righteous Fury. The kernel flags triggering hits and the adapter resolves
	 * the extra damage die (Foundry-visible). (VERIFY trigger wording against
	 * the core book - remembered as "any hit that inflicts wounds".)
	 */
	righteousFury: { enabled: boolean; trigger: "damaging-hit" };
	/**
	 * Hit-location table: d100 TENS digit -> body location key. Keys follow
	 * the bodyLocations registry (kebab case). (Best-remembered RT core spread,
	 * VERIFY against the book.)
	 */
	hitLocations: Record<string, string>;

	// ------------------------------------------------------------------
	// Extension points for sibling systems (bead yojf). Optional so a
	// profile need only carry what differs; rtCore keeps the values that
	// exist in the repo today and leaves null where content ports or the
	// packs resolve the data (no fabricated values).
	// ------------------------------------------------------------------

	/**
	 * Characteristic vocabulary in book order, plus the i18n label-key prefix
	 * used for characteristic names (RT: "CHARACTERISTIC.WS" etc.). DH2/OW/BC
	 * share the FFG nine; the prefix lets a localisation set differ.
	 */
	characteristics?: { keys: readonly string[]; labelPrefix: string };
	/**
	 * Skill catalog source. RT resolves skills through the content port
	 * (compendium), so there is no static catalog in the profile; a sibling
	 * system may name a pack id instead.
	 */
	skillCatalogPack?: string | null;
	/**
	 * xp/advancement model discriminator. RT records advances in a spent
	 * ledger (advancement.ts); DH2 uses aptitudes, Only War a regiment
	 * structure — those are sibling values.
	 */
	advancement?: { xpModel: "spent-ledger" | "aptitudes" | "regiment" | string };
	/**
	 * Starter Wounds as data (the SpeciesWoundsSpec shape at the rules layer:
	 * multiplier x TB + dice + flat; RT human = 2xTB, dice/wound bonus come
	 * from the origin, Core Rulebook p13). Omitted values fall back to the
	 * rules layer's own defaults.
	 */
	startingWounds?: { toughnessMultiplier: number; dice: string; flat: number };
	/**
	 * Starting Fate model. RT rolls 1d10 against printed bands
	 * (fateFromBands); a table-driven system names "table".
	 */
	startingFate?: { model: "bands" | "table" };
	/**
	 * Psychic/phenomena model: the Perils of the Warp table source. RT
	 * resolves phenomena tables through the content port by name, so the
	 * profile stays null; a sibling system may pin a pack id.
	 */
	psychic?: { phenomenaTablePack: string | null };
	/**
	 * Critical-hit table sources (core + vehicle/battlesuit). Null = resolved
	 * through the content port; a sibling system may pin pack ids.
	 */
	criticalTables?: { core: string | null; vehicle: string | null };
}

/** Rogue Trader core profile. */
export const rtCore: RuleProfile = {
	id: "rt-core",
	critOnDouble: true,
	autoFailRoll: null,
	autoPassRoll: null,
	primitiveArmourDouble: true,
	righteousFury: { enabled: true, trigger: "damaging-hit" },
	characteristics: {
		keys: [
			"ws",
			"bs",
			"s",
			"t",
			"ag",
			"int",
			"per",
			"wp",
			"fel",
		],
		labelPrefix: "CHARACTERISTIC",
	},
	skillCatalogPack: null,
	advancement: { xpModel: "spent-ledger" },
	startingWounds: { toughnessMultiplier: 2, dice: "", flat: 0 },
	startingFate: { model: "bands" },
	psychic: { phenomenaTablePack: null },
	criticalTables: { core: null, vehicle: null },
	// tens digit of the to-hit roll -> body location (VERIFY against book)
	hitLocations: {
		"0": "left-leg",
		"1": "head",
		"2": "right-arm",
		"3": "right-arm",
		"4": "left-arm",
		"5": "left-arm",
		"6": "body",
		"7": "body",
		"8": "right-leg",
		"9": "right-leg",
	},
};
