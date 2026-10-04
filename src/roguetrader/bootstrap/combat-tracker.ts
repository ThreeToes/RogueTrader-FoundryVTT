/**
 * Combat tracker defaults (bead nc3q resource chip; bead jpt3 initiative).
 *
 * INITIATIVE FORMULA (bead jpt3) — set at init, where core's CONFIG object
 * (foundry.mjs:216831 `initiative: { formula: null }`) already exists and
 * nothing overwrites ours afterwards. Core's OWN tracker roll path resolves
 * Combatant#getInitiativeRoll() with NO explicit formula:
 *
 *   formula = formula | | this._getInitiativeFormula()  (foundry.mjs:59885)
 *   _getInitiativeFormula() → String(CONFIG.Combat.initiative.formula | |
 *   game.system.initiative)                 (foundry.mjs:59939-59941)
 *
 * With neither set (our manifest carries no initiative key), core's tracker
 * button built a Roll from the literal string "undefined" and evaluate()
 * threw 'Unresolved StringTerm undefined requested for evaluation'
 * (foundry.mjs:200897). Setting the placeholder-form formula fixes it; the
 * placeholder interpolates against actor.getRollData() — which returns the
 * live system DataModel instance (foundry.mjs:47126-47128) — via
 * Roll.replaceFormulaData → foundry.utils.getProperty (foundry.mjs:34684,
 * 34727 + 2389-2404), and getProperty's prototype-chain read invokes the
 * Character model's initiativeBonus GETTER, so the EFFECTIVE Agility Bonus
 * (gear deltas in) is used: the tracker path and the explicit sheet-roll path
 * produce identical results. Actor types whose model has no such key (vehicle,
 * starship…) degrade to "1d10 + 0" through Roll.parse's missing:"0"
 * (foundry.mjs:34684) instead of crashing. The formula constant lives in
 * rules/derived.ts (INITIATIVE_FORMULA) so the two consumption routes cannot
 * diverge; see its jsdoc.
 *
 * TRACKER RESOURCE (bead nc3q):
 *
 * Foundry v14's combat tracker has a SINGLE resource slot per encounter: each
 * combatant row resolves its chip value from
 *
 *   Combatant#updateResource: getProperty(actor.system, combat.settings.resource) ?? null
 *   (foundry.mjs:59927-59928), where `combat.settings` is the world setting
 *   `core.combatTrackerConfig` (Combat#settings, foundry.mjs:80363; the
 *   setting's schema is one StringField for the resource path,
 *   foundry.mjs:80300). A blank default means fresh worlds show NO chip at
 *   all, which suits D&D but reads as no feedback in our tracker.
 *
 * OWNER DECISION (2026-10-04, bead nc3q): the slot defaults to CURRENT
 * WOUNDS — resource path `wounds.value`. Fatigue stays off the tracker; the
 * GM can still repoint the slot (or blank it) through the standard
 * CombatTrackerConfig combobox (TokenDocument.getTrackedAttributes, core
 * untouched), so this module only changes the DEFAULT, never the choice.
 *
 * Mechanism (v14-verified): core registers `core.combatTrackerConfig` during
 * Game#initialize — AFTER the `init` hook (foundry.mjs:206160-206165), so a
 * registration from `init` would simply be replaced by core's. The registration
 * is a plain Map entry keyed by the settings id and `ClientSettings#register`
 * REPLACES it wholesale (foundry.mjs:203893-203901), reusing the DataField
 * type and firing a harmless `reset()` (a re-cast, foundry.mjs:13999) on any
 * stored Setting doc. So: re-register the SAME entry at `ready` (long after
 * core ran) with only `default.resource` overridden. Worlds that already
 * stored a value keep theirs; fresh worlds get Wounds; the combobox keeps
 * working because the schema, onChange and storage wiring are copied verbatim.
 */

/** The combatant resource chip defaults to current Wounds. */
export const TRACKER_RESOURCE = "wounds.value";

/**
 * The core tracking setting this module re-registers (Combat.CONFIG_SETTING,
 * foundry.mjs:80255).
 */
const CORE_TRACKER_SETTING = "combatTrackerConfig";

/**
 * The canonical initiative formula (rules/derived.ts): the single shared
 * shape both consumption routes read (see the module header).
 */
import { INITIATIVE_FORMULA } from "../rules/derived";

/** Shape of one registered GameSetting entry (ClientSettings#register data). */
interface TrackedSetting {
	default?: unknown;
	[key: string]: unknown;
}

/**
 * Re-register `core.combatTrackerConfig` with the resource default pointed at
 * current Wounds. Everything else about the registration (schema type,
 * onChange, scope, labels) is copied from core's entry so the GM's
 * CombatTrackerConfig combobox continues to read and write the same key.
 */
function defaultCombatTrackerResource(): void {
	Hooks.once("ready", () => {
		const settings = game.settings as unknown as
			| {
					settings?: Map<string, TrackedSetting>;
					register(ns: string, key: string, data: object): void;
			  }
			| undefined;
		// Core must have registered first; without it there is nothing to
		// extend (content-optional, like every warmer).
		const registered = settings?.settings?.get(`core.${CORE_TRACKER_SETTING}`);
		if (!settings || !registered || !settings.register) return;
		const priorDefault =
			typeof registered.default === "object" && registered.default !== null
				? (registered.default as Record<string, unknown>)
				: {};
		settings.register("core", CORE_TRACKER_SETTING, {
			...registered,
			default: {
				...priorDefault,
				resource: TRACKER_RESOURCE,
			},
		});
	});
}

/** Register the combat tracker defaults (called once from the composition root). */
export function registerCombatTrackerDefault(): void {
	// Bead jpt3: the placeholder-form formula for core's OWN roll path (see the
	// module header). CONFIG.Combat.initiative.formula is typed
	// `string | null` (fvtt-types config.d.mts:532-535).
	CONFIG.Combat.initiative.formula = INITIATIVE_FORMULA;
	defaultCombatTrackerResource();
}