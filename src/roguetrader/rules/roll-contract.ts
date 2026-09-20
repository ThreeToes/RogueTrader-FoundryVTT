/**
 * The roll request/handler contract (epic kof0, phase 4): the discriminated
 * request union and the per-kind handler interface. Extracted from
 * roll-system.ts so handlers can live in their own modules without a cycle.
 *
 * Types only — no runtime code.
 */

import type { Actor } from "fvtt-types/documents";
import type { Modifier, TestOutcome } from "../../rules-engine/src/index";
import type { TestKind } from "../domain/model/test";
import type { RtMessageFlags } from "./chat-flags";

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
	| "fear";

/** Shared request data. The title is derived per kind in the handler. */
export interface RollBase {
	actor: Actor;
	/** Bypass the modify dialog (fast-forward). */
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
	/** Range band vs the target (book p220): half range +10, long -10. */
	rangeBand?: "half" | "normal" | "long";
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

export type RollRequest =
	| CharacteristicRollRequest
	| SkillRollRequest
	| WeaponRollRequest
	| PsychicRollRequest
	| NavigatorRollRequest
	| ShipWeaponRollRequest
	| ShipRepairRollRequest
	| FearRollRequest;

// ---------------------------------------------------------------------------
// Handler contract
// ---------------------------------------------------------------------------

/** Funnel context passed through to collectTestModifiers (bead hyv/r1k). */
export interface RollContext {
	aimed?: boolean;
	fireMode?: "single" | "burst" | "full";
	flags?: Record<string, boolean>;
	/** Skill-item test name (bead r1k) for "skill:<name>" effect keys. */
	skillName?: string;
}

/** Everything the shared pipeline needs once the handler has prepared. */
export interface PreparedRoll {
	/** Human card/dialog title (actor-qualified). */
	title: string;
	/** Unmodified target (characteristic / skill value). */
	baseTarget: number;
	/** Funnel test kind ("characteristic" | "skill" | "attack" | "focus-power"). */
	testKind: TestKind;
	/** Funnel test key (characteristic key or title surrogate). */
	testKey: string;
	/** Pre-dialog modifier rows (psy bonus, mastery, untrained, caller). */
	initialModifiers: Modifier[];
	/** Weapon shape for funnel effect collection (weapon kind only). */
	weapon: { type: string; special?: string[] } | null;
	/**
	 * Guarded condition flags this handler sets from its own dialog controls
	 * (bead xu83): the generic pre-roll condition toggles must not duplicate
	 * them (e.g. the melee Charge checkbox already drives "charging").
	 */
	handledConditionFlags?: string[];
	/** Pre-dialog funnel context (skill name). */
	context: RollContext;
	/** Extra roll-card template vars (e.g. showDamageButton). */
	templateVars?: Record<string, unknown>;
	/** Flags set on the roll card at creation time. */
	flags?: RtMessageFlags;
	/** Profile override (bead sa6: Focus Power 91+ auto-fail). */
	autoFailRoll?: number | null;
	/** Profile override (bead jpbm: Fearless auto-passes the Fear Test). */
	autoPassRoll?: number | null;
	/** Kind-specific data carried from prepare to after (e.g. psychic strength). */
	kindData?: Record<string, unknown>;
}

/**
 * Per-kind handler. Every hook is optional except prepare (validation +
 * derived data); performRoll runs prepare -> dialog -> post-dialog rows ->
 * shared test pipeline -> after. Handlers that need Foundry UI do it inside
 * their hooks so the orchestrator stays Foundry-shape-free.
 */
export interface RollHandler<K extends RollKind> {
	/** Validate + resolve the request. Null = bail (warnings already shown). */
	prepare(
		request: Extract<RollRequest, { kind: K }>,
	): Promise<PreparedRoll | null>;
	/** Extra TestDialog config (weapon: attack-context selectors). */
	dialogConfig?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
	): object;
	/** Post-dialog modifier rows (weapon: Aim / Inaccurate cancellation). */
	postDialogModifiers?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		dialog: TestDialogResultLike,
	): Modifier[];
	/** Funnel context that depends on the dialog result (weapon: fire mode). */
	testContext?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		dialog: TestDialogResultLike | null,
	): RollContext;
	/** Post-card follow-up (damage flag, evasion, phenomena, power damage). */
	after?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		outcome: TestOutcome,
		messageId: string | null,
		/** Resolved test numbers + final modifier list (bead jpbm). */
		info?: { target: number; modifiers: Modifier[] },
	): Promise<void>;
}

/** Minimal shape of the TestDialog result the hooks consume. */
export interface TestDialogResultLike {
	modifiers: Modifier[];
	/** Guarded condition toggles chosen in the dialog (bead xu83). */
	flags?: Record<string, boolean>;
	attack?: {
		fireMode?: "single" | "burst" | "full";
		aimed?: boolean;
		aimFull?: boolean;
		flags?: Record<string, boolean>;
	};
}
