/**
 * The roll request/handler contract — RT layer (epic kof0, phase 4; bead
 * p7jv).
 *
 * The GENERIC base (RollBase, the handler interface shape, PreparedRoll/
 * RollContext, Modifier plumbing types) lives in
 * src/ffg/application/roll-contract.ts. This file keeps the system-specific
 * half: the closed RT RollKind union, the RT request shapes (psychic,
 * navigator, ship-weapon, ship-repair, fear) and the RT kind-data map, and
 * specialises the generic contract with them.
 *
 * The re-exports below keep every existing import path and call site
 * unchanged — existing call sites must not churn.
 *
 * Types only — no runtime code.
 */

import type { Modifier } from "../../rules-engine/index";
import type {
	PreparedRoll as GenericPreparedRoll,
	RollBase as GenericRollBase,
	RollHandler as GenericRollHandler,
	RollContext as GenericRollContext,
	TestDialogResultLike,
} from "../../ffg/application/roll-contract";
import type { RtMessageFlags } from "./chat-flags";
import type { StrengthLevel } from "./psychic";
import type { ShipWeaponRange } from "../data/item/ship-weapon-range";
import type { ActionEntry } from "./actions";

// The generic plumbing types are re-exported as-is.
export type RollContext = GenericRollContext;
export type { TestDialogResultLike };

// ---------------------------------------------------------------------------
// Requests (discriminated union)
// ---------------------------------------------------------------------------

export type RollKind =
	| "characteristic"
	| "skill"
	| "weapon"
	| "psychic"
	| "navigator"
	| "ship-weapon"
	| "ship-repair"
	| "ship-action"
	| "fear"
	| "snap-out"
	| "initiative"
	| "action";

/** Shared request data (generic base, narrowed to the Foundry Actor). */
export interface RollBase extends GenericRollBase {
	actor: Actor;
	skipDialog?: boolean;
}

export interface CharacteristicRollRequest extends RollBase {
	kind: "characteristic";
	/** Characteristic key ("ws", "bs", ...). */
	key: string;
	/** Caller-provided modifiers, merged with the funnel collection. */
	modifiers?: Modifier[];
}

export interface SkillRollRequest extends RollBase {
	kind: "skill";
	/** Trained attempt: the skill item id. */
	itemId?: string;
	/** Untrained attempt: raw characteristic + display label (no item). */
	characteristicKey?: string;
	label?: string;
	modifiers?: Modifier[];
}

export interface WeaponRollRequest extends RollBase {
	kind: "weapon";
	/** The weapon item id (equip gate + attack dialog + damage flags). */
	itemId: string;
	modifiers?: Modifier[];
}

export interface PsychicRollRequest extends RollBase {
	kind: "psychic";
	itemId: string;
}

export interface NavigatorRollRequest extends RollBase {
	kind: "navigator";
	itemId: string;
}

/**
 * Ship weapon salvo (bead xfta, Core Rulebook pp220-222): a gunner BS test
 * for an installed ship-weapon-component, resolved through the ship-combat
 * kernel (hits, void shields, damage, criticals). The actor is the
 * STARSHIP; the target ship comes from the current Foundry target.
 */
export interface ShipWeaponRollRequest extends RollBase {
	kind: "ship-weapon";
	/** Installed ship-weapon-component item id on the firing ship. */
	itemId: string;
	/**
	 * Range band vs the target (Core Rulebook pp219-220): half range +10,
	 * beyond range -10; "out-of-range" reports a target beyond twice the
	 * weapon's range and the salvo is refused before any dice are rolled.
	 */
	rangeBand?: "half" | "normal" | "long" | "out-of-range";
}

/**
 * Emergency Repairs extended action (bead xfta, book p216-218): a
 * Difficult (-10) Tech-Use test to repair one unpowered/damaged/
 * depressurised component (never destroyed); 1d5 turns, -1 per degree,
 * minimum one. The actor is the STARSHIP; the test runs on the crew skill.
 */
export interface ShipRepairRollRequest extends RollBase {
	kind: "ship-repair";
	/** The installed component item id to repair. */
	itemId: string;
}

/**
 * A ship action (epic necp bead oumh, Core Rulebook pp213-218): one of the
 * Table 8-10 Manoeuvre Actions or Table 8-11 Extended Actions, rolled on the
 * STARSHIP as a combined test — the character's skill plus the ship's ability
 * (Core Rulebook p212). The actor is the STARSHIP; the item is a
 * `ship-action` type carrying the machine test key and difficulty token.
 *
 * Helmsman (owner decision 1): when `performer` names an Explorer, the test
 * runs on THEIR trained skill (with the p75 bare-Pilot fallback when only the
 * bare parent is trained); when absent — NPC vessels, no helmsman picked —
 * the ship's crew-quality skill (Table 8-9, rules/ship-crew.ts) substitutes.
 */
export interface ShipActionRollRequest extends RollBase {
	kind: "ship-action";
	/** The ship-action item id on the starship. */
	itemId: string;
	/**
	 * The optional performer character (the helmsman / gunnery officer). When
	 * undefined the crew-quality fallback applies (Core Rulebook p214 Table
	 * 8-9). S2's picker fills this from the Ship Combat tab.
	 */
	performer?: Actor;
	/** Caller-provided modifiers, merged with the funnel collection. */
	modifiers?: Modifier[];
}

/**
 * Fear Test (bead jpbm, Core Rulebook p295): a Willpower test rolled by the
 * character CONFRONTING the fearsome thing. `rating` is the Fear (X) of the
 * source (an NPC's Fear trait, a Rite of Fear aura, a scene hazard); the
 * severity penalty −(rating−1)×10 rides on the breakdown as a visible
 * modifier (Table 10-3).
 */
export interface FearRollRequest extends RollBase {
	kind: "fear";
	/** Fear rating of the source (Table 10-3 difficulty ladder). */
	rating: number;
	/** Combat failure rolls the Shock Table; non-combat posts the −10 note. */
	situation?: "combat" | "non-combat";
	/** Display name of the fear source for the card. */
	sourceName?: string;
	/** Caller-provided modifiers, merged with the severity penalty. */
	modifiers?: Modifier[];
}

/**
 * "Snap out of it" (bead n0tp, Core Rulebook p296): a Willpower Test to end a
 * snap-out-capable condition. Lives beside the fear kinds because the outcome
 * effects (ending the condition / the failure card) are fear-family rules.
 */
export interface SnapOutRollRequest extends RollBase {
	kind: "snap-out";
	/** Caller-provided modifiers, merged with the funnel collection. */
	modifiers?: Modifier[];
}

export type RollRequest =
	| CharacteristicRollRequest
	| SkillRollRequest
	| WeaponRollRequest
	| PsychicRollRequest
	| NavigatorRollRequest
	| ShipWeaponRollRequest
	| ShipRepairRollRequest
	| ShipActionRollRequest
	| FearRollRequest
	| SnapOutRollRequest
	| InitiativeRollRequest
	| ActionRollRequest;

/**
 * Initiative (bead 77r1, Core Rulebook p212): a RAW d10 plus the derived
 * initiative bonus — no target, no pass/fail ladder. The handler is
 * prepare-only (the handler's after-hook owns the d10, the combatant write
 * and the initiative card); the pipeline still applies the ownership gate
 * and the modifier dialog the hand-rolled sequence in rules/adapter.ts
 * used to bypass.
 */
export interface InitiativeRollRequest extends RollBase {
	kind: "initiative";
}

/** A combat action's printed roll spec (bead et5a, epic moew): the sheet
 * resolves the action's warmed catalog entry FIRST (the chip click surface
 * carries only the name), so the request carries the FULL entry —
 * verbatim name/uuid for the cards, the test vocabulary + difficulty for
 * the prepare.
 */
export interface ActionRollRequest extends RollBase {
	kind: "action";
	/** The warmed catalog entry for the action being rolled. */
	entry: ActionEntry;
	/** Caller-provided modifiers, merged with the funnel collection. */
	modifiers?: Modifier[];
}

// ---------------------------------------------------------------------------
// Handler contract
// ---------------------------------------------------------------------------

/**
 * Per-kind data a handler carries from prepare() to after() (bead ezys).
 *
 * This used to be `Record<string, unknown>`, read back with `as` casts, so a
 * mistyped key was a silent `undefined` rather than a compile error — the same
 * failure mode as FearRollRequest.modifiers, TestDialogResultLike.flags and
 * k98i. Typing the payload per kind removes every cast and makes the key set
 * part of the contract.
 *
 * Kinds with nothing to carry map to `undefined` and simply omit kindData.
 */
export interface RollKindData {
	characteristic: undefined;
	skill: undefined;
	weapon: undefined;
	navigator: undefined;
	/** Rolled Strength + the phenomena triggers (book p157; EA p86). */
	psychic: {
		/** Table 6-1 casting strength. */
		strength: StrengthLevel;
		pushLevels: number;
		sustainedCount: number;
		/** Sorcerer Corruption total, added FIRST to the phenomena roll (EA p86). */
		corruption: number;
		/** "psychic" | "sorcery" (epic 0hap). */
		mode: string;
	};
	/** Ship weapon salvo resolution inputs (bead xfta, book pp220-222). */
	"ship-weapon": {
		weaponKind: "macrobattery" | "lance";
		strength: number;
		damage: string;
		critRating: number;
		range: ShipWeaponRange;
		rangeBand: "half" | "normal" | "long";
		weaponUuid?: string;
	};
	/** Emergency Repairs target (bead xfta, book p216-218). */
	"ship-repair": {
		itemId: string;
		componentId?: string;
	};
	/** The ship-action card inputs (epic necp bead oumh, book pp213-218). */
	"ship-action": {
		itemId: string;
		/** The pack doc's uuid (the card's doc anchor; empty when unset). */
		uuid: string;
		/** The action's verbatim name and cost. */
		name: string;
		actionCost: string;
		/** The terse printed description. */
		description: string;
		/** The printed test string ("Pilot (Space Craft) + Manoeuvrability"). */
		testKey: string;
		/** Printed difficulty token ("Hard (-20)"), empty when none. */
		difficulty: string;
		/** The printed difficulty's machine bits (rules/actions.ts classifier). */
		difficultyKind: "none" | "opposed" | "numeric";
		/** True = no performer: the crew-quality skill substituted (Table 8-9). */
		crewFallback: boolean;
		/** The ship-ability value folded in (p212; also a visible row). */
		shipMod: number;
		/** The p212 COMBINED target (character skill + ship ability). */
		combinedTarget: number;
	};
	/** Fear Test bookkeeping (bead jpbm, p294-296). */
	fear: {
		rating: number;
		/** Picks the Shock Table vs the -10 concentration note. */
		situation: "combat" | "non-combat";
		sourceName: string;
		/** Set on the Unshakeable Faith re-roll so it happens only once. */
		rerolled?: boolean;
	};
	/** Snap-out carries nothing from prepare to after (bead n0tp). */
	"snap-out": undefined;
	/**
	 * Initiative kind data (bead qkq1, Core Rulebook p212-213): which PATH
	 * ran (the card's combat-start notes render on the ship card only) + the
	 * boarding state (the boarded pair drops to last — Core Rulebook p215).
	 * The merged rows themselves ride `info.modifiers` (bead 77r1).
	 */
	initiative: {
		/** True when the roll ran the starship path (1d10 + Detection tens digit). */
		starship: boolean;
		/** S2's `boardedWith` is set on this ship — the card carries the banner. */
		boarded: boolean;
	};
	/** The combat-action card inputs (bead et5a, epic moew). */
	action: {
		/** The catalog entry snapshot: doc link + verbatim card text. */
		entry: ActionEntry;
		/** Printed difficulty was "Opposed" — the card notes manual resolution. */
		opposed: boolean;
	};
}

/**
 * Everything the shared pipeline needs once the handler has prepared — the
 * generic contract specialised with the RT kind-data map (and the RT
 * namespaced flags shape).
 */
export interface PreparedRoll<K extends RollKind = RollKind>
	extends GenericPreparedRoll<K, RollKindData> {
	/** Flags set on the roll card at creation time. */
	flags?: RtMessageFlags;
}

/**
 * Per-kind handler — the generic contract specialised with the RT request
 * union and kind-data map. Shape-compatible with the pre-hoist interface, so
 * handler modules and the registry need no edits.
 */
export type RollHandler<K extends RollKind = RollKind> = GenericRollHandler<
	K,
	RollRequest,
	RollKindData
>;
