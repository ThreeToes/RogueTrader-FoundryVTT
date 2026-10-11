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
import { MAX_CRITICAL_SEVERITY } from "./criticals";

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
	 * Hit-location table: reversed-roll range band -> body location key.
	 * The Core Rulebook (Table 9-6: Hit Locations, printed p244) reverses the
	 * digits of the to-hit percentile roll before reading the table, so bands
	 * are keyed on the REVERSED value: e.g. roll 20 reads as 02.
	 * Keys are "low-high" percents ("86-00" = 86 to 100, since 00 reads as
	 * 100); values follow the bodyLocations registry (kebab case). Parsed by
	 * locationForHit in test.ts.
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
	/**
	 * Critical-Damage severity cap (bead wxut.1): the critical tables print ten
	 * results, so a character cannot accumulate more than ten Critical Damage
	 * in one location. Lifted out of criticals.ts as DATA so a house rule can
	 * retune the cap; that module's constant stays the single source.
	 *
	 * Optional, like the other extension points, so a sibling profile only
	 * carries what differs — consumers fall back to MAX_CRITICAL_SEVERITY.
	 */
	criticals?: { maxSeverity: number };
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
		keys: ["ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel"],
		labelPrefix: "CHARACTERISTIC",
	},
	skillCatalogPack: null,
	advancement: { xpModel: "spent-ledger" },
	startingWounds: { toughnessMultiplier: 2, dice: "", flat: 0 },
	startingFate: { model: "bands" },
	psychic: { phenomenaTablePack: null },
	criticalTables: { core: null, vehicle: null },
	// The critical severity cap as data (bead wxut.1) — read from the kernel
	// constant rather than restated, so criticals.ts stays the single source.
	criticals: { maxSeverity: MAX_CRITICAL_SEVERITY },
	// Core Rulebook Table 9-6: Hit Locations (printed p244), keyed on the
	// reversed roll: 01-10 / 11-20 / 21-30 / 31-70 / 71-85 / 86-00.
	hitLocations: {
		"01-10": "head",
		"11-20": "right-arm",
		"21-30": "left-arm",
		"31-70": "body",
		"71-85": "right-leg",
		"86-00": "left-leg",
	},
};
